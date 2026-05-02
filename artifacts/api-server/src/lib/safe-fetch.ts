import { validateOutboundUrl, logBlockedUrl } from "./url-guard";

export class BlockedUrlError extends Error {
  readonly url: string;
  readonly reason: string;
  constructor(url: string, reason: string) {
    super(`Blocked outbound URL ${url}: ${reason}`);
    this.name = "BlockedUrlError";
    this.url = url;
    this.reason = reason;
  }
}

export interface SafeFetchOptions extends RequestInit {
  context?: string;
}

export async function safeFetch(
  url: string,
  init?: SafeFetchOptions,
): Promise<Response> {
  const guard = validateOutboundUrl(url);
  if (!guard.ok) {
    const reason = guard.reason ?? "blocked";
    logBlockedUrl(init?.context ?? "safeFetch", url, reason);
    throw new BlockedUrlError(url, reason);
  }
  const { context: _ctx, ...rest } = init ?? {};
  void _ctx;
  return fetch(url, {
    redirect: "manual",
    ...rest,
  });
}
