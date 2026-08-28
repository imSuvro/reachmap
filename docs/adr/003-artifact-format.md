# ADR-003: Sectioned fixed-width binary, shipped as opaque `.bin.gz`

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

The compiled graph (ADR-002) must ship small, decode fast, and be
byte-reproducible. Verified platform facts (docs/research.md §3): Vercel's
CDN compresses by MIME allowlist — `application/octet-stream` is **never
compressed**; self-served `Content-Encoding: gzip` is unreliable
(staff-acknowledged open bug); `DecompressionStream` in browsers has a gzip
codec but **no brotli codec**.

## Decision

One content-hashed container `timetable.<sha8>.bin` of 4-byte-aligned,
little-endian, **fixed-width structure-of-arrays sections** behind a JSON
section table, decoded by zero-copy typed-array views. The deployed file is
`timetable.<sha8>.bin.gz` — gzipped **at build time** and served as opaque
bytes with no `Content-Encoding` header; the worker inflates with native
`DecompressionStream('gzip')`. Full byte layout: docs/contracts.md.

## Options Considered

| Option | Verdict |
|---|---|
| Fixed-width sections + build-time gzip (chosen) | No varint decoder to debug; zero-copy views; compression guaranteed regardless of CDN behavior |
| Raw `.bin`, rely on CDN compression | Verified broken: octet-stream is not on Vercel's compression allowlist — 18 MB on the wire every load |
| Pre-compressed `.br`/`.gz` with Content-Encoding header | Unsupported on Vercel static (open bug); brotli additionally undecodable by DecompressionStream |
| Varint/delta wire encoding | Smaller, but a second codec to test; the escape hatch stays: the section table carries an `enc` tag per section, `"raw"` today |
| JSON artifact | ~5× the bytes pre-compression, slow parse, high client memory |

## Trade-off Analysis

Measured scale (spike): 1,313,396 connections × 14 B ≈ 18.4 MB raw + small
sections ≈ **~19 MB container**; gzip expected 4–6 MB (measured in stage 8
and recorded in the manifest). Build-time gzip costs nothing at runtime and
removes every dependency on undocumented CDN behavior. Contingency, only if
wire > 8 MB: shard connections into six 4-hour departure blocks, same
section format per shard — **not activated** (spike says unnecessary).

## Consequences

- Easier: deterministic builds — byte-identical rebuilds and stable content
  hashes, **conditional on** every date-dependent input being anchored in
  config (`referenceDate`, ADR-006) and the resolved-config hash being
  embedded in the section table so config-only changes still move the hash.
  Instant decode (views over one ArrayBuffer after inflate).
- Harder: any format change is a breaking version — the container carries a
  magic + version for that.
- Revisit if: wire > 8 MB, or a city exceeds 65,535 stops (u16 stop index)
  — both are hard build-time assertions, never silent truncation.
