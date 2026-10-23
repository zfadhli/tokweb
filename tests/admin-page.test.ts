import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Engine } from "../src/engine";
import { createApp } from "../src/server";
import { adminRoutes } from "../src/server/pages/admin";
import { cookiePairs, mergeCookies } from "../src/server/settings";
import { Store } from "../src/store";
import { TikTokClient } from "../src/tiktok/client";
import {
  FakeResolver,
  fakeRecorderFactory,
  liveRoom,
  tempDir,
} from "./helpers";

function setup() {
  const dir = tempDir();
  const store = new Store({
    dataDir: join(dir, "data"),
    outputDir: join(dir, "out"),
  }).load();
  const resolver = new FakeResolver(liveRoom());
  const recorder = fakeRecorderFactory();
  const engine = new Engine(store, resolver, { recorder: recorder.factory });
  const deps = { store, engine, client: new TikTokClient() };
  const app = createApp(deps).use(adminRoutes(deps));
  return { dir, store, engine, app };
}

const get = (
  app: ReturnType<typeof setup>["app"],
  path: string,
): Promise<Response> => app.handle(new Request(`http://localhost${path}`));

function putForm(
  app: ReturnType<typeof setup>["app"],
  path: string,
  pairs: [string, string][],
): Promise<Response> {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return app.handle(
    new Request(`http://localhost${path}`, { method: "PUT", body: params }),
  );
}

function savedForm(extra: [string, string][] = []): [string, string][] {
  return [
    ["defaultVariant", "hd"],
    ["defaultIntervalMin", "5"],
    ["defaultMaxDurationMin", "0"],
    ["bitrate", ""],
    ["proxy", ""],
    ["userAgent", ""],
    ["cookie-ttwid", "abc123"],
    ["cookie-msToken", ""],
    ["cookie-tt_chain_token", ""],
    ["cookie-sessionid", ""],
    ["clearCookies", ""],
    ["keepSource", "off"],
    ["keepSource", "on"],
    ...extra,
  ];
}

describe("admin page", () => {
  test("GET /admin renders head, settings form, system, and storage panels", async () => {
    const { app } = setup();
    const response = await get(app, "/admin");
    expect(response.status).toBe(200);
    const page = await response.text();
    for (const marker of [
      '<p class="eyebrow">Admin</p>',
      "<h1>Settings</h1>",
      "Capture defaults, paths, network, and what this machine is doing right now.",
      'id="settings-panel"',
      'hx-put="/admin/settings"',
      'hx-target="#settings-panel"',
      'hx-swap="outerHTML"',
      'hx-disable="find button"',
      'name="defaultVariant"',
      'name="defaultIntervalMin"',
      'name="defaultMaxDurationMin"',
      'placeholder="unlimited"',
      "0 = unlimited",
      'name="bitrate"',
      'placeholder="blank = stream copy"',
      'name="outputDir"',
      'name="ffmpegPath"',
      'name="proxy"',
      'name="userAgent"',
      'name="cookie-ttwid"',
      'name="cookie-msToken"',
      'name="cookie-tt_chain_token"',
      'name="cookie-sessionid"',
      "Status: not set.",
      'name="clearCookies"',
      "Clear saved cookies",
      'name="keepSource"',
      "Keep intermediate TS capture",
      "Save settings",
      "form-actions",
      "data/state.json, plaintext, local only",
      "No stored footage yet.",
    ]) {
      expect(page).toContain(marker);
    }
  });

  test("GET /admin prefills stored cookie values masked with a show/hide toggle", async () => {
    const { app, store } = setup();
    store.state.settings.cookies = "ttwid=abc123; sessionid_ss=keep";
    store.save();
    const page = await (await get(app, "/admin")).text();
    expect(page).toContain('value="abc123"');
    expect(page).toContain('type="password"');
    expect(page).toContain('x-on:click="show = !show"');
    expect(page).toContain("x-text=\"show ? 'Hide' : 'Show'\"");
  });

  test("a stored cookie value with markup renders escaped, not as markup", async () => {
    const { app, store } = setup();
    store.state.settings.cookies = 'ttwid=a<b>&"c';
    store.save();
    const page = await (await get(app, "/admin")).text();
    expect(page).not.toContain('value="a<b>');
    expect(page).toContain('value="a&lt;b&gt;&amp;&quot;c"');
  });

  test("PUT saves minutes as seconds, keepSource, and cookies with a toast", async () => {
    const { app, store } = setup();
    const response = await putForm(app, "/admin/settings", savedForm());
    expect(response.status).toBe(200);
    expect(store.state.settings.defaultIntervalSec).toBe(300);
    expect(store.state.settings.defaultMaxDurationSec).toBe(0);
    expect(store.state.settings.defaultVariant).toBe("hd");
    expect(store.state.settings.keepSource).toBe(true);
    expect(store.state.settings.cookies).toBe("ttwid=abc123");
    const panel = await response.text();
    expect(panel).toContain('id="settings-panel"');
    expect(panel).toContain('<p class="notice">Settings saved.</p>');
    expect(panel).toContain('value="abc123"');
    expect(response.headers.get("HX-Trigger")).toBe(
      JSON.stringify({ toast: { message: "Settings saved.", level: "ok" } }),
    );
  });

  test("PUT with clear cookies and no keepSource clears both", async () => {
    const { app, store } = setup();
    store.state.settings.cookies = "old";
    store.state.settings.keepSource = true;
    const response = await putForm(app, "/admin/settings", [
      ["defaultIntervalMin", "3"],
      ["defaultMaxDurationMin", ""],
      ["keepSource", "off"],
      ["clearCookies", ""],
      ["clearCookies", "1"],
      ["cookie-ttwid", ""],
      ["cookie-msToken", ""],
      ["cookie-tt_chain_token", ""],
      ["cookie-sessionid", ""],
    ]);
    expect(response.status).toBe(200);
    expect(store.state.settings.cookies).toBe("");
    expect(store.state.settings.keepSource).toBe(false);
    expect(store.state.settings.defaultIntervalSec).toBe(180);
    expect(store.state.settings.defaultMaxDurationSec).toBe(0);
  });

  test("blank max means unlimited and an invalid variant keeps the previous value", async () => {
    const { app, store } = setup();
    store.state.settings.defaultVariant = "sd";
    const response = await putForm(app, "/admin/settings", [
      ["defaultVariant", "nope"],
      ["defaultMaxDurationMin", ""],
      ["mystery", "ignored"],
    ]);
    expect(response.status).toBe(200);
    expect(store.state.settings.defaultVariant).toBe("sd");
    expect(store.state.settings.defaultMaxDurationSec).toBe(0);
  });

  test("storage groups by handle, sorts by bytes, and bars share the peak", async () => {
    const { app, store } = setup();
    const now = Date.now();
    store.state.recordings.push(
      {
        id: "rec-big",
        monitorId: null,
        uniqueId: "big",
        roomId: null,
        title: "",
        variant: "best",
        state: "completed",
        file: "big.mp4",
        startedAt: now - 9_000,
        endedAt: now - 8_000,
        durationMs: 60_000,
        bytes: 8_192,
        error: null,
      },
      {
        id: "rec-big2",
        monitorId: null,
        uniqueId: "big",
        roomId: null,
        title: "",
        variant: "best",
        state: "completed",
        file: "big2.mp4",
        startedAt: now - 7_000,
        endedAt: now - 6_000,
        durationMs: 60_000,
        bytes: 8_192,
        error: null,
      },
      {
        id: "rec-small",
        monitorId: null,
        uniqueId: "small",
        roomId: null,
        title: "",
        variant: "best",
        state: "completed",
        file: "small.mp4",
        startedAt: now - 5_000,
        endedAt: now - 4_000,
        durationMs: 30_000,
        bytes: 1_024,
        error: null,
      },
      {
        id: "rec-live",
        monitorId: null,
        uniqueId: "liveone",
        roomId: null,
        title: "",
        variant: "best",
        state: "recording",
        file: "live.ts",
        startedAt: now - 3_000,
        endedAt: null,
        durationMs: 3_000,
        bytes: 999_999,
        error: null,
      },
    );
    const page = await (await get(app, "/admin")).text();
    expect(page).toContain("@big");
    expect(page).toContain("@small");
    expect(page).not.toContain("@liveone");
    expect(page.indexOf("@big")).toBeLessThan(page.indexOf("@small"));
    expect(page).toContain(
      '<span class="storage-bar"><span style="width: 100%"></span></span>',
    );
    expect(page).toContain("width: 6%");
  });

  test("GET /admin renders one input per cookie field with not-set hints", async () => {
    const { app } = setup();
    const page = await (await get(app, "/admin")).text();
    for (const name of ["ttwid", "msToken", "tt_chain_token", "sessionid"]) {
      expect(page).toContain(`name="cookie-${name}"`);
    }
    expect(page).not.toContain('name="cookies"');
    expect(page).not.toContain("super-secret");
    const hints = page.match(/Status: not set\./g) ?? [];
    expect(hints.length).toBe(4);
    expect(page.indexOf('name="cookie-ttwid"')).toBeLessThan(
      page.indexOf('name="cookie-msToken"'),
    );
    expect(page.indexOf('name="cookie-msToken"')).toBeLessThan(
      page.indexOf('name="cookie-tt_chain_token"'),
    );
    expect(page.indexOf('name="cookie-tt_chain_token"')).toBeLessThan(
      page.indexOf('name="cookie-sessionid"'),
    );
  });

  test("PUT with only cookie-ttwid stores it", async () => {
    const { app, store } = setup();
    const response = await putForm(app, "/admin/settings", [
      ["cookie-ttwid", "abc123"],
      ["cookie-msToken", ""],
      ["cookie-tt_chain_token", ""],
      ["cookie-sessionid", ""],
    ]);
    expect(response.status).toBe(200);
    expect(store.state.settings.cookies).toBe("ttwid=abc123");
  });

  test("a second PUT setting only msToken keeps ttwid", async () => {
    const { app, store } = setup();
    await putForm(app, "/admin/settings", [["cookie-ttwid", "abc123"]]);
    const response = await putForm(app, "/admin/settings", [
      ["cookie-msToken", "m1"],
    ]);
    expect(response.status).toBe(200);
    expect(store.state.settings.cookies).toBe("ttwid=abc123; msToken=m1");
  });

  test("blank ttwid removes the stored ttwid while unknown cookies survive", async () => {
    const { app, store } = setup();
    store.state.settings.cookies = "ttwid=old; sessionid_ss=keep";
    store.save();
    const response = await putForm(app, "/admin/settings", [
      ["cookie-ttwid", ""],
      ["cookie-sessionid", "xyz"],
    ]);
    expect(response.status).toBe(200);
    expect(store.state.settings.cookies).toBe(
      "sessionid_ss=keep; sessionid=xyz",
    );
  });

  test("a stored unknown cookie survives a save that sets ttwid", async () => {
    const { app, store } = setup();
    store.state.settings.cookies = "sessionid_ss=x";
    store.save();
    await putForm(app, "/admin/settings", [["cookie-ttwid", "abc123"]]);
    expect(store.state.settings.cookies).toBe("sessionid_ss=x; ttwid=abc123");
  });

  test("submitted and stored cookie values render back escaped", async () => {
    const { app } = setup();
    const response = await putForm(app, "/admin/settings", [
      ["cookie-ttwid", 'zz<secret>&"9'],
    ]);
    expect(response.status).toBe(200);
    const panel = await response.text();
    expect(panel).not.toContain("zz<secret>");
    expect(panel).toContain("zz&lt;secret&gt;&amp;&quot;9");
    const page = await (await get(app, "/admin")).text();
    expect(page).toContain("zz&lt;secret&gt;&amp;&quot;9");
    expect(page).toContain("Status: saved.");
  });

  test("clearCookies empties cookies even when fields are filled", async () => {
    const { app, store } = setup();
    store.state.settings.cookies = "ttwid=old; msToken=old";
    store.save();
    const response = await putForm(app, "/admin/settings", [
      ["cookie-ttwid", "new"],
      ["cookie-msToken", "newm"],
      ["clearCookies", ""],
      ["clearCookies", "1"],
    ]);
    expect(response.status).toBe(200);
    expect(store.state.settings.cookies).toBe("");
  });

  test("a hostile handle renders inert and the toast header stays ASCII", async () => {
    const { app, store } = setup();
    store.state.recordings.push({
      id: "rec-xss",
      monitorId: null,
      uniqueId: '<script>alert("x")</script>',
      roomId: null,
      title: "",
      variant: "best",
      state: "completed",
      file: "x.mp4",
      startedAt: 1,
      endedAt: 2,
      durationMs: 1_000,
      bytes: 512,
      error: null,
    });
    const page = await (await get(app, "/admin")).text();
    expect(page).not.toContain("<script>alert");
    expect(page).toContain("&lt;script&gt;");
    const response = await putForm(app, "/admin/settings", savedForm());
    const raw = response.headers.get("HX-Trigger") ?? "";
    expect(raw).toMatch(/^[\x20-\x7E]*$/);
  });
});

describe("cookiePairs / mergeCookies", () => {
  test("cookiePairs trims, drops empty names, keeps the first occurrence", () => {
    expect(cookiePairs("a=1; b=2")).toEqual({ a: "1", b: "2" });
    expect(cookiePairs("  ttwid=x ; ; =y; ttwid=z")).toEqual({ ttwid: "x" });
    expect(cookiePairs("")).toEqual({});
  });

  test("mergeCookies preserves order and unknown keys, appends new ones", () => {
    expect(mergeCookies("b=2; a=1", { a: "9" })).toBe("b=2; a=9");
    expect(mergeCookies("sessionid_ss=x", { ttwid: "abc" })).toBe(
      "sessionid_ss=x; ttwid=abc",
    );
    expect(mergeCookies("ttwid=old", { ttwid: "  ", msToken: "" })).toBe("");
    expect(mergeCookies("", {})).toBe("");
  });

  test("values with %7C, =, +, . survive verbatim", () => {
    const value = "a%7Cb=c+d.e";
    expect(cookiePairs(`k=${value}`).k).toBe(value);
    expect(mergeCookies("", { k: value })).toBe(`k=${value}`);
  });
});
