import { describe, expect, it } from "vitest";
import { decodeContainer, encodeContainer, MAGIC, section } from "../src/engine/container";
import type { ArtifactCounts } from "../src/engine/types";

const counts: ArtifactCounts = { stops: 3, trips: 2, connections: 4, footpaths: 1 };

describe("container codec", () => {
  it("round-trips sections with values, counts and configHash intact", () => {
    const bytes = encodeContainer(
      [
        { name: "a.u32", data: new Uint32Array([1, 2, 3, 4_000_000_000]) },
        { name: "b.u16", data: new Uint16Array([7, 65535]) },
        { name: "c.u8", data: new Uint8Array([1, 2, 3, 4, 5]) }, // odd length -> padding
        { name: "d.i32", data: new Int32Array([-5, 5]) },
      ],
      counts,
      "cfg123",
    );
    const dec = decodeContainer(bytes.buffer.slice(0) as ArrayBuffer);
    expect(dec.configHash).toBe("cfg123");
    expect(dec.counts).toEqual(counts);
    expect([...section<Uint32Array>(dec, "a.u32")]).toEqual([1, 2, 3, 4_000_000_000]);
    expect([...section<Uint16Array>(dec, "b.u16")]).toEqual([7, 65535]);
    expect([...section<Uint8Array>(dec, "c.u8")]).toEqual([1, 2, 3, 4, 5]);
    expect([...section<Int32Array>(dec, "d.i32")]).toEqual([-5, 5]);
  });

  it("4-aligns every section so zero-copy views are legal", () => {
    const bytes = encodeContainer(
      [
        { name: "odd.u8", data: new Uint8Array([9, 9, 9]) },
        { name: "after.u32", data: new Uint32Array([123456789]) },
      ],
      counts,
      "x",
    );
    // if alignment were wrong, constructing the Uint32Array view would throw
    const dec = decodeContainer(bytes.buffer.slice(0) as ArrayBuffer);
    expect(section<Uint32Array>(dec, "after.u32")[0]).toBe(123456789);
  });

  it("rejects bad magic and truncation", () => {
    const good = encodeContainer([{ name: "a.u8", data: new Uint8Array([1]) }], counts, "x");
    const bad = good.slice();
    bad[0] = 88;
    expect(() => decodeContainer(bad.buffer.slice(0, bad.length) as ArrayBuffer)).toThrow(/magic/);
    expect(() => decodeContainer(good.buffer.slice(0, 10) as ArrayBuffer)).toThrow(/truncated/);
    expect(MAGIC).toHaveLength(8);
  });

  it("missing section accessor names the section", () => {
    const bytes = encodeContainer([{ name: "a.u8", data: new Uint8Array([1]) }], counts, "x");
    const dec = decodeContainer(bytes.buffer.slice(0) as ArrayBuffer);
    expect(() => section(dec, "nope")).toThrow(/nope/);
  });
});
