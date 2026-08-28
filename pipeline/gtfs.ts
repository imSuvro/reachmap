/**
 * GTFS text-layer primitives. All readers operate on a Map<filename, content>
 * so unit tests can feed fixtures directly and build.ts can feed unzipped
 * bytes; nothing here touches the filesystem.
 */

/** Minimal CSV split: fast path on plain commas, quote-aware slow path. */
export function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export interface Table {
  /** column name -> index */
  col: Record<string, number>;
  width: number;
  /** data rows only (header excluded); rows are NOT length-checked here */
  lines: string[];
}

/** Parse one GTFS file: BOM-strip, CRLF-tolerant, trailing blank lines dropped. */
export function readTable(files: Map<string, string>, name: string): Table | null {
  let text = files.get(name);
  if (text === undefined) return null;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lines.length === 0) return null;
  const header = splitCsv(lines[0]!).map((h) => h.trim());
  const col: Record<string, number> = {};
  header.forEach((h, i) => {
    col[h] = i;
  });
  return { col, width: header.length, lines: lines.slice(1) };
}

export function requireTable(files: Map<string, string>, name: string): Table {
  const t = readTable(files, name);
  if (!t) throw new BuildError("missing-file", `required GTFS file absent or empty: ${name}`);
  return t;
}

/** "HH:MM:SS" -> seconds since service-day midnight; >24:00 preserved; -1 on blank/malformed. */
export function hmsToSec(s: string | undefined): number {
  if (!s) return -1;
  const p = s.split(":");
  if (p.length !== 3) return -1;
  const h = Number(p[0]);
  const m = Number(p[1]);
  const sec = Number(p[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || !Number.isInteger(sec)) return -1;
  if (h < 0 || m < 0 || m > 59 || sec < 0 || sec > 59) return -1;
  return h * 3600 + m * 60 + sec;
}

/** Feed strings are attacker-controlled: strip C0 controls + DEL, then cap (contract §2). */
export function sanitizeFeedString(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120);
}

export class BuildError extends Error {
  constructor(
    public code:
      | "missing-file"
      | "stale-calendar"
      | "anemic-weekday"
      | "overflow"
      | "validator"
      | "empty-feed",
    message: string,
  ) {
    super(message);
    this.name = "BuildError";
  }
}

/** yyyymmdd int -> weekday 0=Mon..6=Sun (proleptic Gregorian, UTC). */
export function weekdayOf(yyyymmdd: number): number {
  const y = Math.floor(yyyymmdd / 10000);
  const m = Math.floor((yyyymmdd % 10000) / 100);
  const d = yyyymmdd % 100;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return (wd + 6) % 7;
}

export function addDays(yyyymmdd: number, days: number): number {
  const y = Math.floor(yyyymmdd / 10000);
  const m = Math.floor((yyyymmdd % 10000) / 100);
  const d = yyyymmdd % 100;
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

export function isoToInt(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`bad ISO date: ${iso}`);
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

export function intToIso(d: number): string {
  const s = String(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
