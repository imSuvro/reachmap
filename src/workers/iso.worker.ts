/// <reference lib="webworker" />
/**
 * The routing worker (docs/contracts.md §3): owns download + inflate +
 * decode + queries. Latest-wins query processing; errors carry the query id;
 * a 4xx on a hashed URL triggers one cache-bypassing manifest refetch
 * (deploy-race recovery) before anything is fatal.
 */
import { Engine } from "../engine/engine";
import type { Manifest, WorkerIn, WorkerOut } from "../engine/types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerOut) => scope.postMessage(m);

let engine: Engine | null = null;
let latest: Extract<WorkerIn, { type: "query" }> | null = null;
let pumpScheduled = false;

scope.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    void init(msg.manifestUrl);
  } else if (msg.type === "query") {
    latest = msg; // pre-ready clicks queue here too; last one wins
    schedulePump();
  }
};

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  setTimeout(() => {
    pumpScheduled = false;
    pump();
  }, 0);
}

function pump() {
  if (!engine || !latest) return;
  const q = latest;
  latest = null;
  try {
    const { geojson, stats } = engine.query(q.lat, q.lon, q.weekday, q.depSec);
    post({ type: "result", id: q.id, geojson, stats });
  } catch (e) {
    post({ type: "error", id: q.id, message: String(e), fatal: false });
  }
}

async function fetchManifest(url: string, bypassCache: boolean): Promise<Manifest> {
  const res = await fetch(url, bypassCache ? { cache: "reload" } : undefined);
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
  return (await res.json()) as Manifest;
}

async function downloadArtifact(manifest: Manifest): Promise<Response> {
  const res = await fetch(manifest.artifact.url);
  if (res.ok) return res;
  if (res.status >= 400 && res.status < 500) {
    // a cached manifest may point into a previous deployment — refetch it
    // bypassing caches exactly once and retry (contract §3)
    const fresh = await fetchManifest(new URL(manifest.artifact.url, scope.location.href).pathname.replace(/[^/]+$/, "manifest.json"), true);
    const retry = await fetch(fresh.artifact.url);
    if (retry.ok) return retry;
    throw new Error(`artifact fetch failed after manifest reload: HTTP ${retry.status}`);
  }
  throw new Error(`artifact fetch failed: HTTP ${res.status}`);
}

async function init(manifestUrl: string) {
  try {
    const manifest = await fetchManifest(manifestUrl, false);
    const res = await downloadArtifact(manifest);
    const total = manifest.artifact.gzBytes;
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      post({ type: "progress", phase: "download", loaded, total });
    }
    post({ type: "progress", phase: "decode", loaded: 0, total: manifest.artifact.rawBytes });
    const gz = new Blob(chunks as BlobPart[]);
    const raw = await new Response(
      gz.stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
    engine = new Engine(raw, {
      horizonSec: manifest.horizonSec,
      walking: { speedMps: manifest.walking.speedMps, detour: manifest.walking.detour },
      bands: manifest.bands,
      bbox: manifest.bbox,
      gridCellM: manifest.grid.cellM,
    });
    post({ type: "progress", phase: "decode", loaded: manifest.artifact.rawBytes, total: manifest.artifact.rawBytes });
    post({ type: "ready", manifest });
    schedulePump(); // answer any click that queued during loading
  } catch (e) {
    post({ type: "error", message: String(e), fatal: true });
  }
}
