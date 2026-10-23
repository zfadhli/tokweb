import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  TikTokClient,
  TikTokError,
  type FetchLike,
} from "../src/tiktok/client";

const liveApi = await Bun.file(
  join(import.meta.dir, "fixtures", "live-api.json"),
).text();
const livePage = await Bun.file(
  join(import.meta.dir, "fixtures", "live-page.html"),
).text();

function recorder() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response("<html></html>", { status: 200 });
  };
  return { calls, fetchImpl };
}

describe("TikTok client", () => {
  test("fetches ttwid once, retries a 429, and sends the cookie", async () => {
    let apiCalls = 0;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new TikTokClient({
      retries: 2,
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url === "https://www.tiktok.com/") {
          return new Response("<html></html>", {
            status: 200,
            headers: { "set-cookie": "ttwid=cookie-value; Path=/" },
          });
        }
        apiCalls += 1;
        if (apiCalls === 1) return new Response("", { status: 429 });
        return new Response(liveApi, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const room = await client.resolve({ uniqueId: "streamer" });
    expect(room.status).toBe("live");
    expect(apiCalls).toBe(2);
    expect(
      calls.filter((call) => call.url === "https://www.tiktok.com/"),
    ).toHaveLength(1);
    const apiCall = calls.find((call) => call.url.includes("api-live"));
    const headers = new Headers(apiCall?.init?.headers);
    expect(headers.get("cookie")).toContain("ttwid=cookie-value");
    expect(apiCall?.url).toContain("msToken=");
  });

  test("falls back to the HTML page when the JSON API is blocked", async () => {
    const client = new TikTokClient({
      retries: 1,
      fetch: async (url) => {
        if (url === "https://www.tiktok.com/")
          return new Response("<html></html>", { status: 200 });
        if (url.includes("api-live")) return new Response("", { status: 403 });
        if (url.includes("/@pageuser/live"))
          return new Response(livePage, { status: 200 });
        return new Response("", { status: 404 });
      },
    });
    const room = await client.resolve({
      url: "https://www.tiktok.com/@pageuser/live",
    });
    expect(room.status).toBe("live");
    expect(room.uniqueId).toBe("pageuser");
    expect(room.streams.length).toBeGreaterThan(0);
  });

  test("passes a room id to the API when no username is available", async () => {
    let requested = "";
    const client = new TikTokClient({
      retries: 1,
      fetch: async (url) => {
        if (url === "https://www.tiktok.com/")
          return new Response("<html></html>", { status: 200 });
        requested = url;
        return new Response(liveApi, { status: 200 });
      },
    });
    const room = await client.resolve({ roomId: "7000000000000000001" });
    expect(room.roomId).toBe("7000000000000000001");
    expect(requested).toContain("roomId=7000000000000000001");
  });

  test("reports a blocked lookup instead of hanging", async () => {
    const client = new TikTokClient({
      retries: 1,
      fetch: async (url) => {
        if (url === "https://www.tiktok.com/")
          return new Response("", { status: 403 });
        return new Response("", { status: 403 });
      },
    });
    expect(client.resolve({ uniqueId: "blocked" })).rejects.toThrow("403");
  });

  test("a WAF challenge page surfaces blocked, not parse", async () => {
    const challenge =
      '<html><head><title>Please wait...</title></head><body>Please wait... SlardarWAF<div id="_wafchallengeid">abc</div></body></html>';
    const blockedFetch = async (url: string) => {
      if (url === "https://www.tiktok.com/")
        return new Response("<html></html>", { status: 200 });
      if (url.includes("api-live")) return new Response("", { status: 403 });
      if (url.includes("/@x/live"))
        return new Response(challenge, { status: 200 });
      return new Response("", { status: 404 });
    };
    const client = new TikTokClient({ retries: 1, fetch: blockedFetch });
    let error: unknown;
    try {
      await client.resolve({ uniqueId: "x" });
    } catch (e) {
      error = e;
    }
    // API 403 (blocked) then page challenge (blocked): the block survives,
    // not the page parse error.
    expect(error).toBeInstanceOf(TikTokError);
    expect((error as TikTokError).kind).toBe("blocked");
    expect((error as Error).message).toMatch(/blocked|challenge|WAF/i);

    // Page challenge on its own mentions the challenge + remedy.
    const challengeOnly = new TikTokClient({
      retries: 1,
      fetch: async (url: string) => {
        if (url === "https://www.tiktok.com/")
          return new Response("<html></html>", { status: 200 });
        if (url.includes("api-live"))
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/@x/live"))
          return new Response(challenge, { status: 200 });
        return new Response("", { status: 404 });
      },
    });
    let challengeError: unknown;
    try {
      await challengeOnly.resolve({ uniqueId: "x" });
    } catch (e) {
      challengeError = e;
    }
    expect(challengeError).toBeInstanceOf(TikTokError);
    expect((challengeError as TikTokError).kind).toBe("blocked");
    expect((challengeError as Error).message).toMatch(/challenge/i);
  });

  test("a challenged page is not re-fetched on the next lookup", async () => {
    const challenge =
      '<html><body>Please wait... SlardarWAF<p id="_wafchallengeid"></p></body></html>';
    let pageCalls = 0;
    const client = new TikTokClient({
      retries: 1,
      pageCooldownMs: 60_000,
      fetch: async (url) => {
        if (url === "https://www.tiktok.com/")
          return new Response("<html></html>", { status: 200 });
        if (url.includes("api-live"))
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        pageCalls += 1;
        return new Response(challenge, { status: 200 });
      },
    });
    for (const attempt of [1, 2]) {
      let error: unknown;
      try {
        await client.resolve({ uniqueId: "x" });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(TikTokError);
      expect((error as TikTokError).kind).toBe("blocked");
      expect((error as TikTokError).source).toBe("page");
      expect(pageCalls).toBe(1);
    }
  });

  test("a plain unparseable page still reports parse", async () => {
    const client = new TikTokClient({
      retries: 1,
      fetch: async (url) => {
        if (url === "https://www.tiktok.com/")
          return new Response("<html></html>", { status: 200 });
        if (url.includes("api-live"))
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        return new Response("<html><body>no data here</body></html>", {
          status: 200,
        });
      },
    });
    let error: unknown;
    try {
      await client.resolve({ uniqueId: "plain" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TikTokError);
    expect((error as TikTokError).kind).toBe("parse");
  });
});
