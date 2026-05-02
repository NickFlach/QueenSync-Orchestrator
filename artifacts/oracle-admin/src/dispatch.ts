import { spawn } from "node:child_process";
import type pino from "pino";

export interface DispatchPayload {
  taskId: string;
  intent?: string;
  requiredCapability: string;
  priority?: number;
  context?: Record<string, unknown>;
  callbackUrl: string;
  armId?: string;
  /**
   * Echoed signatures shipped by QueenSync — the shim posts the matching
   * one back so QueenSync accepts the callback without the shim ever
   * needing the callback secret directly.
   */
  // (read from request headers; not part of body schema)
}

interface DispatchHeaders {
  completedSignature?: string | undefined;
  failedSignature?: string | undefined;
}

export type Logger = pino.Logger;

/**
 * Capability → handler. Each handler returns a short result string (or
 * throws on failure). The shim sends the status + result back to QueenSync.
 */
type Handler = (
  p: DispatchPayload,
  log: Logger,
  fetcher: typeof fetch,
) => Promise<string>;

const HANDLERS: Record<string, Handler> = {
  restart_radio: async (_p, log) => {
    await runShell("sudo", ["systemctl", "restart", "radio.service"], log);
    return "radio.service restarted";
  },
  restart_observatory: async (_p, log) => {
    await runShell("sudo", ["systemctl", "restart", "observatory.service"], log);
    return "observatory.service restarted";
  },
  trigger_oration_now: async (p, log, fetcher) => {
    const radio = process.env["RADIO_BASE_URL"] ?? "https://radio.ninja-portal.com";
    const url = `${radio.replace(/\/$/, "")}/admin/oration/now`;
    const intent = p.intent ?? "Oration triggered by QueenSync";
    const r = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, taskId: p.taskId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`radio /admin/oration/now → HTTP ${r.status}`);
    log.info({ url, status: r.status }, "oration triggered");
    return `oration triggered (${r.status})`;
  },
  setOverride: async (p, log, fetcher) => {
    const target = String(p.context?.["target"] ?? "");
    const value = String(p.context?.["value"] ?? "");
    if (!target) throw new Error("setOverride requires context.target");
    const obs =
      process.env["OBSERVATORY_BASE_URL"] ?? "https://observatory.ninja-portal.com";
    const url = `${obs.replace(/\/$/, "")}/admin/override`;
    const r = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, value, taskId: p.taskId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`observatory /admin/override → HTTP ${r.status}`);
    log.info({ target, value, status: r.status }, "override set");
    return `override(${target}=${value}) accepted`;
  },
  dream_trigger: async (p, log, fetcher) => {
    const url = process.env["KANNAKA_DREAM_TRIGGER_URL"] ?? "";
    if (!url) {
      // Fall back to local systemctl unit
      await runShell("sudo", ["systemctl", "start", "kannaka-dream.service"], log);
      return "kannaka-dream.service started";
    }
    const r = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: p.taskId, source: "queensync" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`dream trigger → HTTP ${r.status}`);
    return `dream cycle triggered (${r.status})`;
  },
  kannaka_status: async (_p, log, fetcher) => {
    const url =
      process.env["KANNAKA_STATUS_URL"] ?? "http://127.0.0.1:7777/status";
    const r = await fetcher(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`kannaka /status → HTTP ${r.status}`);
    const text = await r.text();
    log.info({ url, length: text.length }, "kannaka status fetched");
    // Truncate so the result column in QueenSync stays readable.
    return text.length > 800 ? text.slice(0, 800) + "…" : text;
  },
};

function runShell(
  cmd: string,
  args: string[],
  log: Logger,
  timeoutMs = 15_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (b) => stdout.push(b));
    child.stderr?.on("data", (b) => stderr.push(b));
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) {
        if (out) log.debug({ cmd, args, stdout: out }, "shell ok");
        resolve();
      } else {
        reject(
          new Error(
            `${cmd} ${args.join(" ")} exited with code ${code}: ${err || out}`,
          ),
        );
      }
    });
  });
}

export interface RunDispatchOptions {
  headers?: DispatchHeaders;
  /** Inject a custom HTTP fetcher (tests). */
  fetcher?: typeof fetch;
}

export async function runDispatch(
  payload: DispatchPayload,
  log: Logger,
  opts: RunDispatchOptions = {},
): Promise<void> {
  const handler = HANDLERS[payload.requiredCapability];
  const fetcher = opts.fetcher ?? fetch;
  let status: "completed" | "failed";
  let result: string;
  try {
    if (!handler) {
      throw new Error(
        `unsupported capability: ${payload.requiredCapability}`,
      );
    }
    result = await handler(payload, log, fetcher);
    status = "completed";
  } catch (err) {
    status = "failed";
    result = (err as Error).message;
    log.warn({ err, taskId: payload.taskId }, "handler failed");
  }
  await postCallback(payload, status, result, log, opts);
}

async function postCallback(
  p: DispatchPayload,
  status: "completed" | "failed",
  result: string,
  log: Logger,
  opts: RunDispatchOptions,
): Promise<void> {
  if (!p.callbackUrl) {
    log.warn({ taskId: p.taskId }, "no callbackUrl — cannot ack");
    return;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const sig =
    status === "completed"
      ? opts.headers?.completedSignature
      : opts.headers?.failedSignature;
  if (sig) headers["X-QueenSync-Signature"] = sig;
  const body =
    status === "completed"
      ? { status, result }
      : { status, error: result };
  const fetcher = opts.fetcher ?? fetch;
  try {
    const r = await fetcher(p.callbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    log.info(
      { taskId: p.taskId, status, callbackStatus: r.status },
      "callback posted",
    );
  } catch (err) {
    log.error({ err, taskId: p.taskId }, "callback failed");
  }
}

export const __testing = { HANDLERS };
