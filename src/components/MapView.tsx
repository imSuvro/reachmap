"use client";
/**
 * MapLibre map: basemap (with graticule fallback per ADR-008), ring layers
 * (band[i] minus band[i-1], computed with polygon-clipping — presentation
 * concern per contract §3), origin pin, click-to-set-origin.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  Map as MlMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type ErrorEvent as MlErrorEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre derives its worker URL from import.meta.url, which webpack points
// into /_next/static/chunks/ where no worker exists — the map then silently
// never fetches a single tile. The worker files are served as plain statics
// (scripts/sync-maplibre-worker.mjs keeps them in lockstep with the package).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
import polygonClipping from "polygon-clipping";
import type { BandCollection, Manifest } from "../engine/types";

const BAND_STYLE: Record<number, { color: string; fill: number }> = {
  900: { color: "#FFB300", fill: 0.44 },
  1800: { color: "#F4511E", fill: 0.4 },
  2700: { color: "#C2185B", fill: 0.36 },
  3600: { color: "#4527A0", fill: 0.3 },
};
const FALLBACK_STYLE_COLORS = ["#8E24AA", "#5E35B1", "#3949AB", "#1E88E5"];

function bandStyle(band: number, i: number) {
  return BAND_STYLE[band] ?? { color: FALLBACK_STYLE_COLORS[i % 4]!, fill: 0.35 };
}

type Ring = GeoJSON.Feature<GeoJSON.MultiPolygon, { band: number }>;

/** cumulative nested bands -> disjoint rings */
function toRings(geojson: BandCollection): GeoJSON.FeatureCollection {
  const features: Ring[] = [];
  for (let i = 0; i < geojson.features.length; i++) {
    const cur = geojson.features[i]!;
    const curCoords = cur.geometry.coordinates as polygonClipping.MultiPolygon;
    let ring: polygonClipping.MultiPolygon = curCoords;
    if (i > 0) {
      const inner = geojson.features[i - 1]!.geometry.coordinates as polygonClipping.MultiPolygon;
      if (curCoords.length && inner.length) {
        try {
          ring = polygonClipping.difference(curCoords, inner);
        } catch {
          ring = curCoords; // degenerate geometry: fall back to cumulative
        }
      }
    }
    features.push({
      type: "Feature",
      properties: { band: cur.properties.band },
      geometry: { type: "MultiPolygon", coordinates: ring as unknown as number[][][][] },
    } as Ring);
  }
  return { type: "FeatureCollection", features };
}

const GRATICULE_STYLE: StyleSpecification = {
  version: 8,
  name: "graticule-fallback",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#EDEAE3" } }],
};

export interface MapViewProps {
  manifest: Manifest;
  origin: { lat: number; lon: number };
  geojson: BandCollection | null;
  highlight: number;
  computing: boolean;
  onSelectOrigin(lat: number, lon: number): void;
  onMapShown(): void;
  /** fatal=true: the map itself could not initialize (no WebGL) */
  onBasemapLost(fatal: boolean): void;
}

export function MapView(props: MapViewProps) {
  const { manifest } = props;
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const loadedRef = useRef(false);
  const fallbackRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  const rings = useMemo(() => (props.geojson ? toRings(props.geojson) : null), [props.geojson]);
  const ringsRef = useRef(rings);
  ringsRef.current = rings;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const dv = manifest.defaultView;
    let map: MlMap;
    try {
      map = new MlMap({
        container: divRef.current,
        style: manifest.map.styleUrl,
        center: [dv.lon, dv.lat],
        zoom: dv.zoom,
        attributionControl: { compact: false, customAttribution: manifest.feed.attributionHtml },
      });
    } catch (e) {
      // WebGL unavailable (old device, GPU-less browser): keep the poster and
      // the shell alive instead of white-screening the whole app
      console.warn("map init failed", e);
      propsRef.current.onBasemapLost(true);
      return;
    }
    mapRef.current = map;
    // e2e/diagnostic seam: rendered-feature assertions need the instance
    (window as unknown as { __rmMap?: MlMap }).__rmMap = map;
    const styleLoadedRef = { current: false };
    map.once("styledata", () => {
      styleLoadedRef.current = true;
    });

    const pinEl = document.createElement("div");
    pinEl.className = "pin";
    markerRef.current = new Marker({ element: pinEl })
      .setLngLat([propsRef.current.origin.lon, propsRef.current.origin.lat])
      .addTo(map);

    const addLayers = () => {
      if (map.getSource("rings")) return;
      map.addSource("rings", {
        type: "geojson",
        data: ringsRef.current ?? { type: "FeatureCollection", features: [] },
      });
      for (let i = 0; i < manifest.bands.length; i++) {
        const b = manifest.bands[i]!;
        const s = bandStyle(b, i);
        map.addLayer({
          id: `band-fill-${b}`,
          type: "fill",
          source: "rings",
          filter: ["==", ["get", "band"], b],
          paint: { "fill-color": s.color, "fill-opacity": s.fill },
        });
        map.addLayer({
          id: `band-line-${b}`,
          type: "line",
          source: "rings",
          filter: ["==", ["get", "band"], b],
          paint: { "line-color": s.color, "line-opacity": 0.9, "line-width": 1.5 },
        });
      }
    };

    map.on("load", () => {
      loadedRef.current = true;
      addLayers();
      propsRef.current.onMapShown();
    });
    map.on("error", (e: MlErrorEvent) => {
      // Graticule fallback (ADR-008) ONLY when the STYLE itself failed to
      // load. Per-tile/sprite/glyph failures also fire map-level `error`
      // before `load` — a single transient tile 404 must not permanently
      // degrade the basemap (stage-12 review finding, verified against
      // maplibre-gl source).
      if (!styleLoadedRef.current && !fallbackRef.current) {
        fallbackRef.current = true;
        const fb = manifest.map.styleFallback;
        map.setStyle(fb ? fb : GRATICULE_STYLE);
        map.once("styledata", () => {
          loadedRef.current = true;
          addLayers();
          propsRef.current.onMapShown();
          propsRef.current.onBasemapLost(false);
        });
      } else if (process.env.NODE_ENV !== "production") {
        console.warn("map error", e.error);
      }
    });
    map.on("click", (e: MapLayerMouseEvent) => {
      propsRef.current.onSelectOrigin(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      delete (window as unknown as { __rmMap?: MlMap }).__rmMap;
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
     
  }, [manifest]);

  // data updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !rings) return;
    const src = map.getSource("rings") as GeoJSONSource | undefined;
    src?.setData(rings as GeoJSON.GeoJSON);
  }, [rings]);

  // pin follows the origin; the camera follows only when the origin left the
  // view (programmatic moves — e2e seam, future URL state; a real click is
  // always in view and must not yank the camera)
  useEffect(() => {
    markerRef.current?.setLngLat([props.origin.lon, props.origin.lat]);
    const map = mapRef.current;
    if (map && loadedRef.current) {
      const b = map.getBounds();
      if (!b.contains([props.origin.lon, props.origin.lat])) {
        map.easeTo({ center: [props.origin.lon, props.origin.lat], duration: 600 });
      }
    }
  }, [props.origin]);

  // computing dim + ruler highlight
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (let i = 0; i < manifest.bands.length; i++) {
      const b = manifest.bands[i]!;
      const s = bandStyle(b, i);
      const dimmed = props.highlight !== -1 && props.highlight !== i;
      const factor = props.computing ? 0.35 : 1;
      const fill = (dimmed ? 0.15 * s.fill : s.fill) * factor;
      const line = (dimmed ? 0.25 : 0.9) * factor;
      if (map.getLayer(`band-fill-${b}`)) {
        map.setPaintProperty(`band-fill-${b}`, "fill-opacity", fill);
        map.setPaintProperty(`band-line-${b}`, "line-opacity", line);
      }
    }
  }, [props.highlight, props.computing, manifest.bands]);

  return <div ref={divRef} className="map" aria-label="Map. Click anywhere to set the origin." />;
}
