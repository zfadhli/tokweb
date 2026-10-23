import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Engine } from "../src/engine";
import { createApp } from "../src/server";
import { adminRoutes } from "../src/server/pages/admin";
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
    ["cookies", "secret"],
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
      'name="cookies"',
      'rows="4"',
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

  test("saved cookies never render into the page", async () => {
    const { app, store } = setup();
    store.state.settings.cookies = "super-secret-cookies";
    store.save();
    const page = await (await get(app, "/admin")).text();
    expect(page).not.toContain("super-secret-cookies");
    expect(page).toContain("Status: saved.");
  });

  test("PUT saves minutes as seconds, keepSource, and cookies with a toast", async () => {
    const { app, store } = setup();
    const response = await putForm(app, "/admin/settings", savedForm());
    expect(response.status).toBe(200);
    expect(store.state.settings.defaultIntervalSec).toBe(300);
    expect(store.state.settings.defaultMaxDurationSec).toBe(0);
    expect(store.state.settings.defaultVariant).toBe("hd");
    expect(store.state.settings.keepSource).toBe(true);
    expect(store.state.settings.cookies).toBe("secret");
    const panel = await response.text();
    expect(panel).toContain('id="settings-panel"');
    expect(panel).toContain('<p class="notice">Settings saved.</p>');
    expect(panel).not.toContain("secret");
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
      ["cookies", ""],
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
