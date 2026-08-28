"use client";
/**
 * Client orchestrator: tiered loading (ADR-007), worker lifecycle,
 * query state, and the dial. Tier 1 renders the poster (the LCP element);
 * tier 2 mounts the map + default isochrone; tier 3 spawns the worker on
 * idle or first map interaction, whichever comes first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { BandCollection, Manifest, QueryStats, WorkerOut } from "../engine/types";
import { Dial } from "./Dial";
import { DataNote } from "./DataNote";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), { ssr: false });

export interface EngineUiState {
  phase: "idle" | "loading" | "decoding" | "ready" | "failed";
  loaded: number;
  total: number;
  message?: string;
}

export function App({ manifest }: { manifest: Manifest }) {
  const dv = manifest.defaultView;
  const [origin, setOrigin] = useState({ lat: dv.lat, lon: dv.lon });
  const [weekday, setWeekday] = useState(dv.weekday);
  const [depSec, setDepSec] = useState(dv.depSec);
  const [engineState, setEngineState] = useState<EngineUiState>({ phase: "idle", loaded: 0, total: 0 });
  const [geojson, setGeojson] = useState<BandCollection | null>(null);
  const [stats, setStats] = useState<QueryStats | null>(null);
  const [computing, setComputing] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [noteOpen, setNoteOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const [posterVisible, setPosterVisible] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const qidRef = useRef(0);
  const pendingRef = useRef(0);

  // tier 2: the precomputed default isochrone renders before the engine exists
  useEffect(() => {
    if (!manifest.defaultIsochrone) return;
    let alive = true;
    fetch(manifest.defaultIsochrone.url)
      .then((r) => r.json())
      .then((g: BandCollection) => {
        if (alive) setGeojson((cur) => cur ?? g);
      })
      .catch(() => {
        /* the live engine will replace it anyway */
      });
    return () => {
      alive = false;
    };
  }, [manifest.defaultIsochrone]);

  const dispatchQuery = useCallback(
    (lat: number, lon: number, wd: number, dep: number) => {
      const w = workerRef.current;
      if (!w) return;
      const id = ++qidRef.current;
      pendingRef.current = id;
      setComputing(true);
      w.postMessage({ type: "query", id, lat, lon, weekday: wd, depSec: dep });
    },
    [],
  );

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return;
    const w = new Worker(new URL("../workers/iso.worker.ts", import.meta.url));
    workerRef.current = w;
    setEngineState({ phase: "loading", loaded: 0, total: manifest.artifact.gzBytes });
    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === "progress") {
        setEngineState({
          phase: m.phase === "download" ? "loading" : "decoding",
          loaded: m.loaded,
          total: m.total,
        });
      } else if (m.type === "ready") {
        readyRef.current = true;
        setEngineState({ phase: "ready", loaded: 0, total: 0 });
      } else if (m.type === "result") {
        if (m.id !== pendingRef.current) return; // stale
        setGeojson(m.geojson);
        setStats(m.stats);
        setComputing(false);
      } else if (m.type === "error") {
        if (m.fatal) {
          setEngineState({ phase: "failed", loaded: 0, total: 0, message: m.message });
        }
        if (m.id !== undefined && m.id === pendingRef.current) setComputing(false);
      }
    };
    w.postMessage({ type: "init", manifestUrl: `/data/${manifest.city}/manifest.json` });
  }, [manifest]);

  // the poster must never be able to cover a working map indefinitely: if the
  // map's load event is delayed (throttled tab, suspended rAF), fade anyway
  useEffect(() => {
    const t = window.setTimeout(() => setPosterVisible(false), 8000);
    return () => window.clearTimeout(t);
  }, []);

  // tier 3: idle spawn (or first map interaction via ensureWorker)
  useEffect(() => {
    const spawn = () => ensureWorker();
    const ric = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
    if (typeof ric === "function") {
      const id = ric(spawn, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(spawn, 2500);
    return () => window.clearTimeout(t);
  }, [ensureWorker]);

  // once ready, the live engine recomputes the current view (seamless swap)
  useEffect(() => {
    if (engineState.phase === "ready") {
      dispatchQuery(origin.lat, origin.lon, weekday, depSec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState.phase]);

  const onSelectOrigin = useCallback(
    (lat: number, lon: number) => {
      setHint(false);
      setOrigin({ lat, lon });
      ensureWorker();
      dispatchQuery(lat, lon, weekday, depSec);
    },
    [weekday, depSec, ensureWorker, dispatchQuery],
  );

  const onTimeChange = useCallback(
    (wd: number, dep: number) => {
      setWeekday(wd);
      setDepSec(dep);
      ensureWorker();
      dispatchQuery(origin.lat, origin.lon, wd, dep);
    },
    [origin, ensureWorker, dispatchQuery],
  );

  const readout = useMemo(() => {
    const coords = `${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)}`;
    if (stats?.outOfCoverage) return { coords, note: "Outside the covered area for this feed." };
    if (stats?.walkOnly) return { coords, note: "Walk-only from here — no transit reachable within the hour." };
    if (stats) return { coords, note: `≈ ${stats.reachedLast.toLocaleString("en-IN")} stops in 60 min` };
    return { coords, note: "…" };
  }, [origin, stats]);

  return (
    <div className="stage">
      <MapView
        manifest={manifest}
        origin={origin}
        geojson={geojson}
        highlight={highlight}
        computing={computing}
        onSelectOrigin={onSelectOrigin}
        onMapShown={() => setPosterVisible(false)}
        onBasemapLost={() => setToast("Base map unavailable — showing reachability only.")}
      />
      {manifest.poster && (
        // the poster is a build-time-optimized static WebP with explicit
        // dimensions (ADR-007); next/image would add a runtime optimizer for no gain
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={`poster${posterVisible ? "" : " poster-hidden"}`}
          src={manifest.poster.url}
          width={manifest.poster.width}
          height={manifest.poster.height}
          alt={`Default isochrone: where transit reaches from ${manifest.cityName}'s center`}
          fetchPriority="high"
          decoding="async"
        />
      )}

      <header className="brand">
        <h1>ReachMap</h1>
        <span>
          {manifest.cityName} · {manifest.subtitle}
        </span>
      </header>

      {hint && <div className="hint">Tap anywhere on the map to move the origin</div>}
      {toast && <div className="toast">{toast}</div>}

      {noteOpen ? (
        <DataNote manifest={manifest} onClose={() => setNoteOpen(false)} />
      ) : (
        <Dial
          bands={manifest.bands}
          tzLabel={manifest.tzLabel}
          weekday={weekday}
          depSec={depSec}
          onChange={onTimeChange}
          highlight={highlight}
          onHighlight={setHighlight}
          engineState={engineState}
          artifactMb={manifest.artifact.gzBytes / 1e6}
          readout={readout}
          onInfo={() => setNoteOpen(true)}
        />
      )}
    </div>
  );
}
