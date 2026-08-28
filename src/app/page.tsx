import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "../engine/types";
import { App } from "../components/App";
import "./app.css";

// Fully static: the manifest is read at build time from the committed data
// (ADR-007 — Vercel's build is `next build` over committed statics).
export const dynamic = "force-static";

function loadManifest(): Manifest {
  const path = join(process.cwd(), "public", "data", "chennai", "manifest.json");
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

export default function Home() {
  const manifest = loadManifest();
  return <App manifest={manifest} />;
}
