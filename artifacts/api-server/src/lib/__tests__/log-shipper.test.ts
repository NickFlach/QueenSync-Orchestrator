import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listRotatedFiles,
  makeShipper,
  runShipAndPrune,
  readConfig,
  type LogShipper,
} from "../log-shipper";
import { parseRotatedTimestamp } from "../log-export";

let dir: string;
const base = "audit.log";

function ts(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

async function makeRotated(d: Date, body = "{}\n"): Promise<string> {
  const p = join(dir, `${base}.${ts(d)}`);
  await writeFile(p, body);
  return p;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "log-shipper-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseRotatedTimestamp", () => {
  it("round-trips timestamps", () => {
    const d = new Date("2026-05-02T12:34:56.789Z");
    const name = `audit.log.${ts(d)}`;
    const parsed = parseRotatedTimestamp(name);
    assert.ok(parsed);
    assert.equal(parsed!.toISOString(), d.toISOString());
  });

  it("returns null for non-rotated names", () => {
    assert.equal(parseRotatedTimestamp("audit.log"), null);
    assert.equal(parseRotatedTimestamp("audit.log.bak"), null);
  });
});

describe("listRotatedFiles", () => {
  it("only returns files matching the rotated suffix and base", async () => {
    await writeFile(join(dir, "audit.log"), "");
    await writeFile(join(dir, "audit.log.bak"), "");
    await writeFile(join(dir, "other.log.2026-05-02T12-34-56-789Z"), "");
    const wanted = await makeRotated(new Date("2026-05-02T12:34:56.789Z"));
    const found = await listRotatedFiles(dir, base);
    assert.deepEqual(found, [wanted]);
  });
});

describe("runShipAndPrune", () => {
  it("uploads then deletes rotated files when shipper succeeds", async () => {
    const fresh = await makeRotated(new Date());
    const uploads: string[] = [];
    const shipper: LogShipper = {
      name: "test",
      async upload(p) {
        uploads.push(p);
      },
    };
    const summary = await runShipAndPrune({
      dir,
      base,
      retentionMs: 30 * 86_400_000,
      shipper,
    });
    assert.equal(summary.uploaded, 1);
    assert.deepEqual(uploads, [fresh]);
    assert.deepEqual(await readdir(dir), []);
  });

  it("prunes expired files even without a shipper", async () => {
    const old = await makeRotated(new Date("2020-01-01T00:00:00.000Z"));
    const young = await makeRotated(new Date("2026-05-02T00:00:00.000Z"));
    const summary = await runShipAndPrune({
      dir,
      base,
      retentionMs: 30 * 86_400_000,
      shipper: null,
      now: () => new Date("2026-05-02T01:00:00.000Z").getTime(),
    });
    assert.equal(summary.pruned, 1);
    const remaining = await readdir(dir);
    assert.deepEqual(remaining, [old, young].map((p) => p.split("/").pop()).filter((n) => n!.includes("2026")));
  });

  it("retries upload on failure but prunes once expired", async () => {
    const old = await makeRotated(new Date("2020-01-01T00:00:00.000Z"));
    const young = await makeRotated(new Date("2026-05-02T00:00:00.000Z"));
    const shipper: LogShipper = {
      name: "broken",
      async upload() {
        throw new Error("nope");
      },
    };
    const summary = await runShipAndPrune({
      dir,
      base,
      retentionMs: 30 * 86_400_000,
      shipper,
      now: () => new Date("2026-05-02T01:00:00.000Z").getTime(),
    });
    assert.equal(summary.failed, 2);
    assert.equal(summary.pruned, 1);
    assert.equal(summary.uploaded, 0);
    const remaining = await readdir(dir);
    assert.equal(remaining.length, 1);
    assert.ok(remaining[0]!.includes("2026"));
    void old;
    void young;
  });
});

describe("makeShipper misconfiguration", () => {
  it("rejects s3 without bucket", async () => {
    await assert.rejects(
      () => makeShipper("s3", {}),
      /QUEENSYNC_LOG_S3_BUCKET/,
    );
  });

  it("rejects replit-object-storage without bucket", async () => {
    await assert.rejects(
      () => makeShipper("replit-object-storage", {}),
      /QUEENSYNC_LOG_GCS_BUCKET/,
    );
  });

  it("rejects logtail without token", async () => {
    await assert.rejects(
      () => makeShipper("logtail", {}),
      /QUEENSYNC_LOG_LOGTAIL_TOKEN/,
    );
  });

  it("returns a logtail shipper that POSTs ndjson lines as a JSON array", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response("", { status: 202 });
    }) as unknown as typeof fetch;
    try {
      const shipper = await makeShipper("logtail", {
        QUEENSYNC_LOG_LOGTAIL_TOKEN: "tkn",
        QUEENSYNC_LOG_LOGTAIL_HOST: "https://example.test/ingest",
      });
      const file = await makeRotated(
        new Date(),
        '{"a":1}\n{"a":2}\n',
      );
      await shipper.upload(file);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "https://example.test/ingest");
      const headers = calls[0]!.init!.headers as Record<string, string>;
      assert.equal(headers.authorization, "Bearer tkn");
      const body = JSON.parse(calls[0]!.init!.body as string);
      assert.deepEqual(body, [{ a: 1 }, { a: 2 }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("readConfig", () => {
  it("defaults to retention-only with 30-day window", () => {
    const cfg = readConfig({});
    assert.equal(cfg.target, null);
    assert.equal(cfg.retentionMs, 30 * 86_400_000);
  });

  it("parses recognised targets", () => {
    assert.equal(readConfig({ QUEENSYNC_LOG_SHIP_TARGET: "s3" }).target, "s3");
    assert.equal(
      readConfig({ QUEENSYNC_LOG_SHIP_TARGET: "Logtail" }).target,
      "logtail",
    );
    assert.equal(
      readConfig({ QUEENSYNC_LOG_SHIP_TARGET: "replit-object-storage" }).target,
      "replit-object-storage",
    );
  });

  it("respects retention override", () => {
    const cfg = readConfig({ QUEENSYNC_LOG_RETENTION_DAYS: "7" });
    assert.equal(cfg.retentionMs, 7 * 86_400_000);
  });
});
