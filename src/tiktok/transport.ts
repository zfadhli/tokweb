import { fetch as wreqFetch, getEmulationHeaders } from "wreq-js";
import type { FetchLike } from "./client";

// Must stay in sync with what wreq-js exposes (getProfiles()); the UA below
// must come from the same profile or the header contradicts the TLS fingerprint.
export const BROWSER_PROFILE = "chrome_136";

export function desktopUserAgent(): string {
  return getEmulationHeaders(BROWSER_PROFILE).get("user-agent") ?? "";
}

// SAFETY: wreq ships its own Response class with the same shape (status, ok,
// text(), headers.getSetCookie()), so the cast is confined to this wrapper.
export const transportFetch: FetchLike = (url, init) =>
  wreqFetch(url, {
    ...init,
    browser: BROWSER_PROFILE,
  }) as unknown as Promise<Response>;
