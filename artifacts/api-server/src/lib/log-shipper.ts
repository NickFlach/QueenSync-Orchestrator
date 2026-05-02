import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { logger } from "./logger";
import {
  getLogExportPath,
  parseRotatedTimestamp,
  ROTATED_SUFFIX_RE,
} from "./log-export";

// ---------------------------------------------------------------------------
// Wave 5 — log shipper
//
// Periodically scans the directory containing `QUEENSYNC_LOG_FILE` for
// rotated `audit.log.<iso-ts>` files, uploads each to a configured
// destination, and deletes the local copy on success. Files older than
// the retention window are pruned locally even if they were never
// uploaded — this is a defence in depth so the Reserved VM disk cannot
// fill up if the upload target goes down for an extended period.
//
// Targets are pluggable via `QUEENSYNC_LOG_SHIP_TARGET`:
//   - `s3`                    — AWS S3 (requires `@aws-sdk/client-s3`)
//   - `replit-object-storage` — Replit App Storage / GCS
//                               (requires `@google-cloud/storage`)
//   - `logtail`               — Better Stack / Logtail HTTP ingest
//   - unset                   — no upload, only retention pruning
//
// SDK packages are loaded with dynamic `import()` so they are only
// required when the corresponding target is enabled. If the SDK is
// missing, the shipper logs once and falls back to retention-only mode.
// ---------------------------------------------------------------------------

const TARGET_ENV = "QUEENSYNC_LOG_SHIP_TARGET";
const INTERVAL_ENV = "QUEENSYNC_LOG_SHIP_INTERVAL_MS";
const RETENTION_ENV = "QUEENSYNC_LOG_RETENTION_DAYS";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_RETENTION_DAYS = 30;

export type ShipTarget = "s3" | "replit-object-storage" | "logtail";

export interface LogShipper {
  readonly name: string;
  upload(filePath: string): Promise<void>;
}

export interface ShipperConfig {
  target: ShipTarget | null;
  intervalMs: number;
  retentionMs: number;
  exportPath: string | null;
}

export function readConfig(env = process.env): ShipperConfig {
  const target = (env[TARGET_ENV] || "").trim().toLowerCase();
  let resolved: ShipTarget | null = null;
  if (target === "s3" || target === "replit-object-storage" || target === "logtail") {
    resolved = target;
  } else if (target !== "") {
    logger.warn({ target }, "log-shipper: unknown target — ignoring");
  }

  let intervalMs = DEFAULT_INTERVAL_MS;
  const rawInt = env[INTERVAL_ENV];
  if (rawInt) {
    const n = Number(rawInt);
    if (Number.isFinite(n) && n >= 1000) intervalMs = Math.floor(n);
  }

  let retentionDays = DEFAULT_RETENTION_DAYS;
  const rawRet = env[RETENTION_ENV];
  if (rawRet) {
    const n = Number(rawRet);
    if (Number.isFinite(n) && n > 0) retentionDays = Math.floor(n);
  }

  return {
    target: resolved,
    intervalMs,
    retentionMs: retentionDays * 24 * 60 * 60 * 1000,
    exportPath: getLogExportPath(),
  };
}

/**
 * List rotated audit-log files in `dir` whose names start with
 * `<base>.` and end with the rotated-timestamp suffix.
 */
export async function listRotatedFiles(
  dir: string,
  base: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const prefix = `${base}.`;
  return entries
    .filter((n) => n.startsWith(prefix) && ROTATED_SUFFIX_RE.test(n))
    .sort()
    .map((n) => join(dir, n));
}

// --- target factories -----------------------------------------------------

// Optional SDK packages — loaded with dynamic import + variable specifier
// so TypeScript does not require the modules to be present at build time.
// Operators install the SDK only for the target they actually use.
async function loadOptional(spec: string): Promise<any> {
  // Indirection through a variable defeats TS's compile-time resolution
  // of the import specifier; the runtime call still works normally.
  const dynamicImport = new Function("s", "return import(s);") as (
    s: string,
  ) => Promise<any>;
  return dynamicImport(spec);
}

async function makeS3Shipper(env: NodeJS.ProcessEnv): Promise<LogShipper> {
  const bucket = env["QUEENSYNC_LOG_S3_BUCKET"];
  if (!bucket) {
    throw new Error("QUEENSYNC_LOG_S3_BUCKET is required for target=s3");
  }
  const prefix = (env["QUEENSYNC_LOG_S3_PREFIX"] || "queensync/audit/").replace(
    /^\/+|\/+$/g,
    "",
  );
  const region = env["AWS_REGION"] || env["AWS_DEFAULT_REGION"];
  let mod: any;
  try {
    mod = await loadOptional("@aws-sdk/client-s3");
  } catch (err) {
    throw new Error(
      "log-shipper: target=s3 selected but `@aws-sdk/client-s3` is not installed. Run `pnpm --filter @workspace/api-server add @aws-sdk/client-s3` to enable it.",
      { cause: err as Error },
    );
  }
  const client = new mod.S3Client(region ? { region } : {});
  return {
    name: `s3://${bucket}/${prefix}`,
    async upload(filePath) {
      const body = await readFile(filePath);
      await client.send(
        new mod.PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/${basename(filePath)}`,
          Body: body,
          ContentType: "application/x-ndjson",
        }),
      );
    },
  };
}

async function makeGcsShipper(env: NodeJS.ProcessEnv): Promise<LogShipper> {
  const bucket =
    env["QUEENSYNC_LOG_GCS_BUCKET"] || env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucket) {
    throw new Error(
      "QUEENSYNC_LOG_GCS_BUCKET (or DEFAULT_OBJECT_STORAGE_BUCKET_ID) is required for target=replit-object-storage",
    );
  }
  const prefix = (env["QUEENSYNC_LOG_GCS_PREFIX"] || "queensync/audit/").replace(
    /^\/+|\/+$/g,
    "",
  );
  let mod: any;
  try {
    mod = await loadOptional("@google-cloud/storage");
  } catch (err) {
    throw new Error(
      "log-shipper: target=replit-object-storage selected but `@google-cloud/storage` is not installed. Run `pnpm --filter @workspace/api-server add @google-cloud/storage` to enable it.",
      { cause: err as Error },
    );
  }
  const storage = new mod.Storage();
  const bkt = storage.bucket(bucket);
  return {
    name: `gs://${bucket}/${prefix}`,
    async upload(filePath) {
      await bkt.upload(filePath, {
        destination: `${prefix}/${basename(filePath)}`,
        contentType: "application/x-ndjson",
      });
    },
  };
}

function makeLogtailShipper(env: NodeJS.ProcessEnv): LogShipper {
  const token = env["QUEENSYNC_LOG_LOGTAIL_TOKEN"];
  if (!token) {
    throw new Error(
      "QUEENSYNC_LOG_LOGTAIL_TOKEN is required for target=logtail",
    );
  }
  const host = env["QUEENSYNC_LOG_LOGTAIL_HOST"] || "https://in.logs.betterstack.com";
  return {
    name: `logtail:${host}`,
    async upload(filePath) {
      const buf = await readFile(filePath, "utf8");
      const lines = buf.split("\n").filter((l) => l.length > 0);
      // Logtail accepts a JSON array of records.
      const batch = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { raw: l };
        }
      });
      const res = await fetch(host, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`logtail upload failed: ${res.status} ${body.slice(0, 200)}`);
      }
    },
  };
}

export async function makeShipper(
  target: ShipTarget,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LogShipper> {
  switch (target) {
    case "s3":
      return makeS3Shipper(env);
    case "replit-object-storage":
      return makeGcsShipper(env);
    case "logtail":
      return makeLogtailShipper(env);
  }
}

// --- main loop ------------------------------------------------------------

/**
 * Run a single ship-and-prune pass. Exported for tests.
 *
 * - Uploads each rotated file via `shipper.upload` (when provided) and
 *   deletes the local copy on success.
 * - Files older than `retentionMs` are deleted unconditionally.
 *
 * Returns a summary suitable for logging.
 */
export async function runShipAndPrune(opts: {
  dir: string;
  base: string;
  retentionMs: number;
  shipper: LogShipper | null;
  now?: () => number;
}): Promise<{ uploaded: number; pruned: number; failed: number }> {
  const now = opts.now ?? (() => Date.now());
  const files = await listRotatedFiles(opts.dir, opts.base);
  let uploaded = 0;
  let pruned = 0;
  let failed = 0;
  for (const file of files) {
    const rotatedAt = parseRotatedTimestamp(basename(file));
    const ageMs = rotatedAt ? now() - rotatedAt.getTime() : 0;
    const expired = ageMs > opts.retentionMs;

    if (opts.shipper) {
      try {
        await opts.shipper.upload(file);
        await unlink(file);
        uploaded++;
        continue;
      } catch (err) {
        failed++;
        if (expired) {
          // Even if upload fails, prune to protect the disk.
          try {
            await unlink(file);
            pruned++;
            logger.warn(
              { file, err },
              "log-shipper: upload failed but file expired — pruned",
            );
          } catch (rmErr) {
            logger.error({ file, err: rmErr }, "log-shipper: prune failed");
          }
        } else {
          logger.warn({ file, err }, "log-shipper: upload failed — will retry");
        }
        continue;
      }
    }

    if (expired) {
      try {
        await unlink(file);
        pruned++;
      } catch (err) {
        logger.error({ file, err }, "log-shipper: prune failed");
      }
    }
  }
  return { uploaded, pruned, failed };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic ship-and-prune loop. No-op if `QUEENSYNC_LOG_FILE`
 * is unset. Safe to call multiple times — only the first call wires up
 * the timer.
 */
export async function startLogShipper(): Promise<void> {
  if (timer) return;
  const cfg = readConfig();
  if (!cfg.exportPath) {
    logger.info("log-shipper: QUEENSYNC_LOG_FILE unset — shipper disabled");
    return;
  }
  const dir = dirname(cfg.exportPath);
  const base = basename(cfg.exportPath);

  let shipper: LogShipper | null = null;
  if (cfg.target) {
    try {
      shipper = await makeShipper(cfg.target);
      logger.info(
        { target: cfg.target, dest: shipper.name, intervalMs: cfg.intervalMs },
        "log-shipper: enabled",
      );
    } catch (err) {
      logger.error(
        { err, target: cfg.target },
        "log-shipper: failed to initialise — falling back to retention-only mode",
      );
    }
  } else {
    logger.info(
      { intervalMs: cfg.intervalMs, retentionDays: cfg.retentionMs / 86_400_000 },
      "log-shipper: no target configured — running in retention-only mode",
    );
  }

  // Guard against overlapping passes — uploads of large rotated files
  // can take longer than the tick interval. A second concurrent pass
  // would race on the same files (duplicate uploads, noisy unlink ENOENT).
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      // Skip if the dir doesn't exist yet — first rotation hasn't happened.
      try {
        await stat(dir);
      } catch {
        return;
      }
      const summary = await runShipAndPrune({
        dir,
        base,
        retentionMs: cfg.retentionMs,
        shipper,
      });
      if (summary.uploaded || summary.pruned || summary.failed) {
        logger.info(summary, "log-shipper: tick");
      }
    } catch (err) {
      logger.error({ err }, "log-shipper: tick failed");
    } finally {
      inFlight = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, cfg.intervalMs);
  // Don't keep the event loop alive solely for the shipper.
  if (typeof timer.unref === "function") timer.unref();
  // Run a first pass shortly after boot.
  setTimeout(() => void tick(), 5_000).unref?.();
}

/** Test helper — stop the loop. */
export function stopLogShipper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
