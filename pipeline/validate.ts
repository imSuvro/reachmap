/**
 * Official MobilityData gtfs-validator gate (ADR-010, research §1).
 * ERROR-severity notices fail the build unless their code is in the city
 * config's allowlist (codes whose offending rows the pipeline itself skips
 * deterministically). Warnings never fail.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "./gtfs";

const TOOLS = join(import.meta.dirname, ".cache", "tools");
const VALIDATOR_VERSION = "8.0.1";
const VALIDATOR_URL = `https://github.com/MobilityData/gtfs-validator/releases/download/v${VALIDATOR_VERSION}/gtfs-validator-${VALIDATOR_VERSION}-cli.jar`;

export interface ValidatorSummary {
  tool: "gtfs-validator";
  version: string;
  errors: number;
  warnings: number;
  errorCodes: Record<string, number>;
  allowlisted: string[];
}

interface ReportNotice {
  severity: string;
  code: string;
  totalNotices: number;
}

export async function runValidator(zipPath: string, allowlist: string[]): Promise<ValidatorSummary> {
  mkdirSync(TOOLS, { recursive: true });
  const jar = join(TOOLS, `gtfs-validator-${VALIDATOR_VERSION}-cli.jar`);
  if (!existsSync(jar)) {
    const res = await fetch(VALIDATOR_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`validator download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000_000) throw new Error(`validator jar suspiciously small (${buf.length} bytes)`);
    // atomic install: a crash mid-write must not poison the cache forever
    const tmp = `${jar}.tmp`;
    writeFileSync(tmp, buf);
    renameSync(tmp, jar);
  }
  const outDir = join(import.meta.dirname, ".cache", "validator", "current");
  mkdirSync(outDir, { recursive: true });
  execFileSync("java", ["-jar", jar, "-i", zipPath, "-o", outDir], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10 * 60 * 1000,
  });
  return summarizeReport(readFileSync(join(outDir, "report.json"), "utf8"), allowlist);
}

/** Split out for unit testing against a canned report.json. */
export function summarizeReport(reportJson: string, allowlist: string[]): ValidatorSummary {
  const report = JSON.parse(reportJson) as { notices?: ReportNotice[] };
  const notices = report.notices ?? [];
  const errorCodes: Record<string, number> = {};
  let errors = 0;
  let warnings = 0;
  for (const n of notices) {
    if (n.severity === "ERROR") {
      errors += n.totalNotices;
      errorCodes[n.code] = (errorCodes[n.code] ?? 0) + n.totalNotices;
    } else if (n.severity === "WARNING") {
      warnings += n.totalNotices;
    }
  }
  const offending = Object.keys(errorCodes).filter((c) => !allowlist.includes(c));
  if (offending.length > 0) {
    throw new BuildError(
      "validator",
      `gtfs-validator ERROR codes not allowlisted: ${offending
        .map((c) => `${c} x${errorCodes[c]}`)
        .join(", ")}`,
    );
  }
  return {
    tool: "gtfs-validator",
    version: VALIDATOR_VERSION,
    errors,
    warnings,
    errorCodes,
    allowlisted: Object.keys(errorCodes).sort(),
  };
}
