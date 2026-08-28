/**
 * Artifact container codec (docs/contracts.md §1). Isomorphic — no Node
 * imports; the pipeline encodes, the worker decodes, tests round-trip.
 *
 * Layout: 8-byte magic "RCHMAP01" · u32 tableLen · UTF-8 JSON section table ·
 * zero-pad to 4-byte alignment · data region (each section 4-byte aligned).
 * Section offsets are relative to the data region.
 */
import type {
  ArtifactCounts,
  DecodedArtifact,
  SectionEntry,
  SectionTable,
  SectionType,
  TypedArray,
} from "./types";

export const MAGIC = "RCHMAP01";

const CTORS: Record<
  SectionType,
  { new (b: ArrayBuffer, off: number, len: number): TypedArray; BYTES_PER_ELEMENT: number }
> = {
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  i32: Int32Array,
  f32: Float32Array,
};

function typeOf(a: TypedArray): SectionType {
  if (a instanceof Uint8Array) return "u8";
  if (a instanceof Uint16Array) return "u16";
  if (a instanceof Uint32Array) return "u32";
  if (a instanceof Int32Array) return "i32";
  if (a instanceof Float32Array) return "f32";
  throw new Error("unsupported typed array");
}

const align4 = (n: number) => (n + 3) & ~3;

export interface NamedSection {
  name: string;
  data: TypedArray;
}

export function encodeContainer(
  sections: NamedSection[],
  counts: ArtifactCounts,
  configHash: string,
): Uint8Array {
  // little-endian host assumed (every platform we target is LE); guard anyway
  assertLittleEndian();
  const entries: SectionEntry[] = [];
  let off = 0;
  for (const s of sections) {
    entries.push({ name: s.name, off, len: s.data.byteLength, type: typeOf(s.data), enc: "raw" });
    off = align4(off + s.data.byteLength);
  }
  const table: SectionTable = { sections: entries, counts, configHash };
  const tableBytes = new TextEncoder().encode(JSON.stringify(table));
  const dataStart = align4(12 + tableBytes.length);
  const total = dataStart + off;
  const out = new Uint8Array(total);
  // magic + tableLen
  for (let i = 0; i < 8; i++) out[i] = MAGIC.charCodeAt(i);
  new DataView(out.buffer).setUint32(8, tableBytes.length, true);
  out.set(tableBytes, 12);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const e = entries[i]!;
    out.set(
      new Uint8Array(s.data.buffer, s.data.byteOffset, s.data.byteLength),
      dataStart + e.off,
    );
  }
  return out;
}

export function decodeContainer(buf: ArrayBuffer): DecodedArtifact {
  assertLittleEndian();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12) throw new Error("container truncated");
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error("bad container magic");
  }
  const tableLen = new DataView(buf).getUint32(8, true);
  if (12 + tableLen > bytes.length) throw new Error("container table truncated");
  const table = JSON.parse(
    new TextDecoder().decode(bytes.subarray(12, 12 + tableLen)),
  ) as SectionTable;
  const dataStart = align4(12 + tableLen);
  const sections = new Map<string, TypedArray>();
  for (const e of table.sections) {
    const Ctor = CTORS[e.type];
    if (!Ctor) throw new Error(`unknown section type ${e.type}`);
    const abs = dataStart + e.off;
    if (abs + e.len > bytes.length) throw new Error(`section ${e.name} out of bounds`);
    sections.set(e.name, new Ctor(buf, abs, e.len / Ctor.BYTES_PER_ELEMENT));
  }
  return { counts: table.counts, configHash: table.configHash, sections };
}

/** Required-section accessor: throws with the section name on absence. */
export function section<T extends TypedArray>(a: DecodedArtifact, name: string): T {
  const s = a.sections.get(name);
  if (!s) throw new Error(`missing section ${name}`);
  return s as T;
}

function assertLittleEndian() {
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) {
    throw new Error("big-endian host unsupported");
  }
}
