import { isAbsolute, join, resolve } from "node:path";
import type { Variant } from "../core/types";
import { VARIANTS } from "../core/types";
import type { Store } from "../store";
import type { ServerDeps } from "./deps";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// The cookies the resolver actually needs, not a browser dump. ttwid is the
// one the client reads itself and the WAF challenge sets; the rest are what
// people copy from a real header.
export const COOKIE_FIELDS: Array<{ name: string; label: string }> = [
  { name: "ttwid", label: "ttwid" },
  { name: "msToken", label: "msToken" },
  { name: "tt_chain_token", label: "tt_chain_token" },
  { name: "sessionid", label: "sessionid" },
];

export function cookiePairs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const at = part.indexOf("=");
    const name = (at < 0 ? part : part.slice(0, at)).trim();
    if (!name || name in out) continue;
    out[name] = (at < 0 ? "" : part.slice(at + 1)).trim();
  }
  return out;
}

export function mergeCookies(
  raw: string,
  updates: Record<string, string>,
): string {
  const merged = cookiePairs(raw);
  for (const [name, value] of Object.entries(updates)) {
    if (!name.trim()) continue;
    const next = value.trim();
    if (!next) delete merged[name];
    else merged[name] = next;
  }
  return Object.entries(merged)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function publicSettings(store: Store): Record<string, unknown> {
  const { cookies, ...rest } = store.state.settings;
  return { ...rest, hasCookies: cookies.trim().length > 0 };
}

export async function updateSettings(
  deps: ServerDeps,
  body: unknown,
): Promise<void> {
  const input = isRecord(body) ? body : {};
  const settings = deps.store.state.settings;
  if (typeof input.outputDir === "string" && input.outputDir.trim()) {
    const nextDir = resolve(process.cwd(), input.outputDir.trim());
    if (nextDir !== settings.outputDir) {
      const previousDir = settings.outputDir;
      for (const recording of deps.store.state.recordings) {
        if (!recording.file || isAbsolute(recording.file)) continue;
        const previousPath = join(previousDir, recording.file);
        if (await Bun.file(previousPath).exists())
          recording.file = previousPath;
      }
      settings.outputDir = nextDir;
    }
  }
  if (typeof input.ffmpegPath === "string" && input.ffmpegPath.trim())
    settings.ffmpegPath = input.ffmpegPath.trim();
  if (typeof input.proxy === "string") settings.proxy = input.proxy.trim();
  if (typeof input.userAgent === "string")
    settings.userAgent = input.userAgent.trim();
  if (typeof input.cookies === "string") {
    settings.cookies = input.cookies;
    deps.client.setCookies(input.cookies);
  }
  deps.client.setNetwork({
    proxy: settings.proxy,
    userAgent: settings.userAgent,
  });
  if (typeof input.keepSource === "boolean")
    settings.keepSource = input.keepSource;
  if (typeof input.bitrate === "string") {
    const value = input.bitrate.trim();
    settings.bitrate = /^(\d+(\.\d+)?[kKmM]?)?$/.test(value)
      ? value
      : settings.bitrate;
  }
  if (
    typeof input.defaultVariant === "string" &&
    (VARIANTS as readonly string[]).includes(input.defaultVariant)
  ) {
    settings.defaultVariant = input.defaultVariant as Variant;
  }
  if (typeof input.defaultIntervalSec === "number") {
    settings.defaultIntervalSec = Math.min(
      86_400,
      Math.max(10, Math.round(input.defaultIntervalSec)),
    );
  }
  if (typeof input.defaultMaxDurationSec === "number") {
    settings.defaultMaxDurationSec = Math.min(
      86_400,
      Math.max(0, Math.round(input.defaultMaxDurationSec)),
    );
  }
  deps.store.save();
}
