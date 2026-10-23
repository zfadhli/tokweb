import type {
  LiveRoom,
  ResolveInput,
  StreamSource,
  Variant,
} from "../core/types";
import { parseLivePage, parseLiveRoomResponse, pickStream } from "./parse";
import { desktopUserAgent, transportFetch } from "./transport";

export interface LiveResolver {
  resolve(input: ResolveInput): Promise<LiveRoom>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface TikTokOptions {
  cookies?: string;
  proxy?: string;
  userAgent?: string;
  fetch?: FetchLike;
  retries?: number;
  pageCooldownMs?: number;
}

export class TikTokError extends Error {
  readonly status: number | null;
  readonly kind: "blocked" | "network" | "not-found" | "parse";
  /** Which lookup produced the error: the JSON API or the profile page. */
  readonly source: "api" | "page";
  constructor(
    message: string,
    kind: TikTokError["kind"],
    status: number | null = null,
    source: TikTokError["source"] = "api",
  ) {
    super(message);
    this.name = "TikTokError";
    this.kind = kind;
    this.status = status;
    this.source = source;
  }
}

const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TOKEN_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const PAGE_COOLDOWN_MS = 10 * 60_000; // a challenged page stays challenged; don't re-ask every tick.

function isChallengePage(html: string): boolean {
  return /_wafchallengeid|SlardarWAF/.test(html);
}

function randomToken(length = 107): string {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const byte of bytes) out += TOKEN_CHARS[byte % TOKEN_CHARS.length];
  return out;
}

const COOKIE_NAME = /^[A-Za-z0-9_.\-]+$/;

/**
 * Drop anything a Cookie header cannot carry. A pasted multi-line blob is
 * either several cookies (a newline before `name=`) or one value wrapped
 * across lines (a newline anywhere else), and neither may reach the header.
 */
export function sanitizeCookieHeader(raw: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const normalized = raw.replace(/\r?\n(?=\s*[A-Za-z0-9_.\-]+\s*=)/g, ";");
  for (const part of normalized.split(";")) {
    const at = part.indexOf("=");
    const name = (at < 0 ? part : part.slice(0, at)).trim();
    if (!COOKIE_NAME.test(name) || seen.has(name)) continue;
    seen.add(name);
    const value = (at < 0 ? "" : part.slice(at + 1))
      .replace(/[\u0000-\u0020\u007f]/g, "")
      .trim();
    if (!value) continue;
    out.push(`${name}=${value}`);
  }
  return out.join("; ");
}

/** Accept upstream cookies.json (`[{name,value}]`), a map, or a Cookie header. */
export function cookieHeader(input: string | undefined): string {
  const raw = input?.trim();
  if (!raw) return "";
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const pairs: Array<[string, string]> = [];
        for (const item of parsed) {
          if (typeof item !== "object" || item === null) continue;
          const entry = item as Record<string, unknown>;
          const name = String(entry.name ?? "");
          if (name) pairs.push([name, String(entry.value ?? "")]);
        }
        return sanitizeCookieHeader(
          pairs.map(([name, value]) => `${name}=${value}`).join("; "),
        );
      }
      if (typeof parsed === "object" && parsed !== null) {
        return sanitizeCookieHeader(
          Object.entries(parsed as Record<string, unknown>)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join("; "),
        );
      }
    } catch {
      // Fall through: the caller may have pasted a raw header.
    }
  }
  return sanitizeCookieHeader(raw);
}

export function normalizeInput(input: ResolveInput): {
  uniqueId: string | null;
  roomId: string | null;
} {
  let uniqueId = input.uniqueId?.trim() ?? "";
  let roomId = input.roomId?.trim() ?? "";
  const url = input.url?.trim() ?? "";

  if (
    uniqueId &&
    (/^https?:\/\//i.test(uniqueId) || /tiktok\.com\//i.test(uniqueId))
  ) {
    const parsed = normalizeInput({ url: uniqueId });
    uniqueId = parsed.uniqueId ?? "";
    roomId = parsed.roomId ?? roomId;
  }

  if (url) {
    const at = url.match(/@([^/?#]+)/);
    if (at?.[1]) uniqueId = decodeURIComponent(at[1]);
    const fromQuery = url.match(/(?:room_?id=)(\d{6,})/i);
    const fromPath = url.match(/\/live\/(\d{6,})/i);
    roomId = fromQuery?.[1] ?? fromPath?.[1] ?? roomId;
    if (!uniqueId && /^\d{6,}$/.test(url)) roomId = url;
  }

  uniqueId = uniqueId.replace(/^@+/, "");
  if (!uniqueId && roomId && !/^\d+$/.test(roomId)) {
    uniqueId = roomId.replace(/^@+/, "");
    roomId = "";
  }
  return { uniqueId: uniqueId || null, roomId: roomId || null };
}

export function selectSource(
  room: LiveRoom,
  variant: Variant,
): StreamSource | null {
  if (room.status !== "live") return null;
  return pickStream(room.streams, variant);
}

export class TikTokClient implements LiveResolver {
  private readonly fetchImpl: FetchLike;
  private ua: string;
  private proxy: string;
  private readonly retries: number;
  private readonly pageCooldownMs: number;
  private pageBlockedUntil = 0;
  private cookies: string;
  private ttwid = "";
  private ttwidAt = 0;
  private ttwidTriedAt = 0;

  constructor(options: TikTokOptions = {}) {
    this.fetchImpl = options.fetch ?? transportFetch;
    this.ua = options.userAgent || desktopUserAgent() || DESKTOP_UA;
    this.proxy = options.proxy ?? "";
    this.cookies = cookieHeader(options.cookies);
    this.retries = Math.max(1, options.retries ?? 3);
    this.pageCooldownMs = options.pageCooldownMs ?? PAGE_COOLDOWN_MS;
  }

  setCookies(cookies: string): void {
    this.cookies = cookieHeader(cookies);
    this.ttwid = "";
    this.ttwidAt = 0;
  }

  setNetwork(options: { proxy?: string; userAgent?: string }): void {
    if (options.proxy !== undefined) this.proxy = options.proxy;
    if (options.userAgent !== undefined)
      this.ua = options.userAgent || desktopUserAgent() || DESKTOP_UA;
  }

  async resolve(input: ResolveInput): Promise<LiveRoom> {
    const { uniqueId, roomId } = normalizeInput(input);
    if (!uniqueId && !roomId) {
      throw new TikTokError(
        "Provide a TikTok username, live URL, or room id.",
        "not-found",
      );
    }

    let lastError: unknown = null;
    let blockedError: TikTokError | null = null;
    try {
      return await this.fromApi(uniqueId, roomId);
    } catch (error) {
      lastError = error;
      if (
        error instanceof TikTokError &&
        error.kind === "blocked" &&
        !blockedError
      ) {
        blockedError = error;
      }
    }

    if (uniqueId) {
      try {
        return await this.fromPage(uniqueId);
      } catch (error) {
        lastError = error;
        if (
          error instanceof TikTokError &&
          error.kind === "blocked" &&
          !blockedError
        ) {
          blockedError = error;
        }
      }
    }

    if (blockedError) throw blockedError;

    const message =
      lastError instanceof Error ? lastError.message : "TikTok lookup failed";
    throw lastError instanceof TikTokError
      ? lastError
      : new TikTokError(message, "network");
  }

  private async fromApi(
    uniqueId: string | null,
    roomId: string | null,
  ): Promise<LiveRoom> {
    const params = new URLSearchParams({ aid: "1988", sourceType: "54" });
    if (uniqueId) params.set("uniqueId", uniqueId);
    if (roomId) params.set("roomId", roomId);

    const body = await this.getJson(
      `https://www.tiktok.com/api-live/user/room/?${params.toString()}`,
      uniqueId ? "https://www.tiktok.com/" : "https://www.tiktok.com/",
    );
    const room = parseLiveRoomResponse(body, uniqueId ?? "");
    if (!room) {
      const code =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>).statusCode
          : null;
      throw new TikTokError(
        `TikTok returned no room data${code !== null ? ` (statusCode ${String(code)})` : ""}.`,
        "parse",
      );
    }
    return room;
  }

  private async fromPage(uniqueId: string): Promise<LiveRoom> {
    // The API still answers while the profile page is challenged, so a page
    // block must not cost a request per tick. The engine ignores page-sourced
    // blocks for its own cooldown for the same reason.
    if (Date.now() < this.pageBlockedUntil) {
      throw new TikTokError(
        `TikTok is still challenging page lookups. Add cookies or a proxy in Settings.`,
        "blocked",
        null,
        "page",
      );
    }
    const response = await this.request(
      `https://www.tiktok.com/@${encodeURIComponent(uniqueId)}/live`,
      {
        headers: { Accept: "text/html,application/xhtml+xml" },
      },
    );
    if (!response.ok) {
      throw new TikTokError(
        `TikTok page lookup failed with HTTP ${response.status}.`,
        "blocked",
        response.status,
        "page",
      );
    }
    const html = await response.text();
    if (isChallengePage(html)) {
      this.pageBlockedUntil = Date.now() + this.pageCooldownMs;
      throw new TikTokError(
        `TikTok served a browser challenge (WAF) instead of the live page. Add cookies or a proxy in Settings.`,
        "blocked",
        response.status,
        "page",
      );
    }
    const room = parseLivePage(html, uniqueId);
    if (!room) {
      throw new TikTokError(
        `Could not read live data for @${uniqueId} from the page.`,
        "parse",
      );
    }
    return room;
  }

  private async getJson(url: string, referer: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      if (attempt > 0)
        await sleep(600 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400));
      try {
        const withToken = `${url}${url.includes("?") ? "&" : "?"}msToken=${randomToken()}`;
        const response = await this.request(withToken, {
          headers: { Referer: referer, Accept: "application/json" },
        });
        if (response.status === 403 || response.status === 429) {
          lastError = new TikTokError(
            `TikTok blocked the request (HTTP ${response.status}). Add cookies in Settings if this persists.`,
            "blocked",
            response.status,
          );
          this.ttwid = "";
          continue;
        }
        if (!response.ok) {
          lastError = new TikTokError(
            `TikTok API returned HTTP ${response.status}.`,
            "network",
            response.status,
          );
          continue;
        }
        const raw = await response.text();
        try {
          return JSON.parse(raw);
        } catch {
          lastError = new TikTokError(
            "TikTok returned a non-JSON response.",
            "parse",
          );
          continue;
        }
      } catch (error) {
        if (error instanceof TikTokError) throw error;
        lastError = new TikTokError(
          error instanceof Error ? error.message : "Network request failed",
          "network",
        );
      }
    }
    throw lastError instanceof TikTokError
      ? lastError
      : new TikTokError("TikTok request failed after retries.", "network");
  }

  private async request(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const cookie = [this.cookies, await this.ensureTtwid()]
      .filter(Boolean)
      .join("; ");
    const headers = new Headers(init.headers);
    headers.set("User-Agent", this.ua);
    headers.set("Accept-Language", "en-US,en;q=0.9");
    if (cookie) headers.set("Cookie", cookie);
    const options: RequestInit & { proxy?: string } = {
      ...init,
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    };
    if (this.proxy) options.proxy = this.proxy;
    return this.fetchImpl(url, options);
  }

  private async ensureTtwid(): Promise<string> {
    if (this.ttwid && Date.now() - this.ttwidAt < 30 * 60_000)
      return `ttwid=${this.ttwid}`;
    const existing = this.cookies.match(/(?:^|;\s*)ttwid=([^;]+)/)?.[1];
    if (existing) {
      this.ttwid = existing;
      this.ttwidAt = Date.now();
      return `ttwid=${existing}`;
    }
    if (this.ttwidTriedAt && Date.now() - this.ttwidTriedAt < 30_000) return "";
    this.ttwidTriedAt = Date.now();
    try {
      const headers = new Headers({
        Accept: "text/html",
        "User-Agent": this.ua,
      });
      const options: RequestInit & { proxy?: string } = {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      };
      if (this.proxy) options.proxy = this.proxy;
      const response = await this.fetchImpl("https://www.tiktok.com/", options);
      const cookies = response.headers.getSetCookie?.() ?? [];
      for (const value of cookies) {
        const match = value.match(/ttwid=([^;]+)/);
        if (match?.[1]) {
          this.ttwid = match[1];
          this.ttwidAt = Date.now();
          return `ttwid=${match[1]}`;
        }
      }
    } catch {
      // A ttwid is best-effort; the API often works without one.
    }
    return "";
  }
}
