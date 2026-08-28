/** Feed download with content-addressed caching. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DownloadResult {
  path: string;
  bytes: number;
  sha256: string;
  downloadedAt: string; // recorded in the cache meta at first download
}

const CACHE = join(import.meta.dirname, ".cache", "feeds");

export async function downloadFeed(url: string, name: string, refresh = false): Promise<DownloadResult> {
  mkdirSync(CACHE, { recursive: true });
  const zipPath = join(CACHE, `${name}.zip`);
  const metaPath = join(CACHE, `${name}.meta.json`);
  if (!refresh && existsSync(zipPath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as DownloadResult;
    const bytes = readFileSync(zipPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 === meta.sha256) return { ...meta, path: zipPath };
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`feed download failed: HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`feed download suspiciously small (${buf.length} bytes)`);
  writeFileSync(zipPath, buf);
  const meta: DownloadResult = {
    path: zipPath,
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    downloadedAt: new Date().toISOString(),
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function ensureDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}
