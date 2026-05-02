import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Wave 5 — append-only log export
//
// In production on a Replit Reserved VM, console output is ephemeral — a
// redeploy wipes it. The Execution Log table in Postgres survives, but the
// auth audit trail and the higher-volume info logs are at risk.
//
// This module appends a single newline-delimited JSON record per
// recordLog() invocation to QUEENSYNC_LOG_FILE (when set), so operators
// can ship the file to an external sink (Logtail, Loki, Datadog) or grep
// it after a forensic incident.
//
// Rotation: when the file exceeds QUEENSYNC_LOG_FILE_MAX_BYTES (default
// 25 MB), it is renamed with a timestamp suffix and a new file is
// started. Operators should periodically prune or ship the rotated
// files (see README — Production Checklist).
// ---------------------------------------------------------------------------

const PATH_ENV = "QUEENSYNC_LOG_FILE";
const MAX_BYTES_ENV = "QUEENSYNC_LOG_FILE_MAX_BYTES";
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

let initialised = false;
let exportPath: string | null = null;
let maxBytes = DEFAULT_MAX_BYTES;
let warnedAboutFailure = false;

async function ensureInitialised(): Promise<void> {
  if (initialised) return;
  initialised = true;
  const raw = process.env[PATH_ENV];
  if (!raw) return;
  exportPath = resolve(raw);
  const max = process.env[MAX_BYTES_ENV];
  if (max) {
    const n = Number(max);
    if (Number.isFinite(n) && n > 0) maxBytes = Math.floor(n);
  }
  try {
    await mkdir(dirname(exportPath), { recursive: true });
    logger.info(
      { path: exportPath, maxBytes },
      "log-export: append-only sink enabled",
    );
  } catch (err) {
    logger.error(
      { err, path: exportPath },
      "log-export: failed to create directory — disabling",
    );
    exportPath = null;
  }
}

export function isLogExportEnabled(): boolean {
  return process.env[PATH_ENV] !== undefined && process.env[PATH_ENV] !== "";
}

async function rotateIfNeeded(): Promise<void> {
  if (!exportPath) return;
  let size = 0;
  try {
    const s = await stat(exportPath);
    size = s.size;
  } catch {
    return; // no file yet
  }
  if (size < maxBytes) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rotated = `${exportPath}.${ts}`;
  try {
    await rename(exportPath, rotated);
    logger.info({ rotated }, "log-export: rotated file");
  } catch (err) {
    logger.warn({ err, rotated }, "log-export: rotation failed");
  }
}

/**
 * Appends a single record to the export file as newline-delimited JSON.
 * Failures are logged once and then swallowed — the export sink is best
 * effort and must never block the request path.
 */
export async function appendLogExport(record: unknown): Promise<void> {
  await ensureInitialised();
  if (!exportPath) return;
  try {
    await rotateIfNeeded();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...(record as object) }) + "\n";
    await appendFile(exportPath, line, { encoding: "utf8" });
  } catch (err) {
    if (!warnedAboutFailure) {
      logger.error({ err, path: exportPath }, "log-export: append failed");
      warnedAboutFailure = true;
    }
  }
}
