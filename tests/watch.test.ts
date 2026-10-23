import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Engine, EngineError } from "../src/engine";
import { createApp } from "../src/server";
import { watchRoutes } from "../src/server/pages/watch";
import { Store } from "../src/store";
import { TikTokClient } from "../src/tiktok/client";
import type { Monitor } from "../src/core/types";
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
  const app = createApp(deps).use(watchRoutes(deps));
  return { dir, store, engine, resolver, app };
}

const get = (
  app: ReturnType<typeof setup>["app"],
  path: string,
): Promise<Response> => app.handle(new Request(`http://localhost${path}`));

const form = (
  app: ReturnType<typeof setup>["app"],
  path: string,
  method: string,
  fields: Record<string, string>,
): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      body: new URLSearchParams(fields),
    }),
  );

function trigger(response: Response): Record<string, unknown> {
  const raw = response.headers.get("HX-Trigger") ?? "{}";
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("watch page", () => {
  test("GET /watch renders head, add form, empty state, and three columns", async () => {
    const { app, engine } = setup();
    const response = await get(app, "/watch");
    expect(response.status).toBe(200);
    const page = await response.text();
    for (const marker of [
      '<p class="eyebrow">Watch</p>',
      "<h1>Users</h1>",
      'name="target"',
      "Username, live URL, or room id",
      "@creator or https://tiktok.com/@creator/live",
      "Add user",
      'hx-post="/watch"',
      'hx-target="#users-panel"',
      'hx-swap="outerHTML"',
      'hx-disable="find button"',
      'hx-get="/partials/users"',
      "refreshUsers from:body, every 3s",
      "innerMorph",
      "No users on watch.",
      "Add a creator above. Polling starts on the next interval.",
    ]) {
      expect(page).toContain(marker);
    }
    await engine.addMonitor({ uniqueId: "gridcase" });
    const grid = await (await get(app, "/watch")).text();
    for (const marker of [
      'class="watch-grid"',
      ">Offline<",
      ">Live<",
      ">Recording<",
      "watch-column-empty",
    ]) {
      expect(grid).toContain(marker);
    }
  });

  test("POST /watch adds a username and returns the panel with a toast", async () => {
    const { app, store } = setup();
    const response = await form(app, "/watch", "POST", {
      target: "@newcreator",
    });
    expect(response.status).toBe(200);
    const panel = await response.text();
    expect(panel).toContain('id="users-panel"');
    expect(panel).toContain("@newcreator");
    const sent = trigger(response);
    expect(sent.refreshUsers).toBe(true);
    expect(JSON.stringify(sent.toast)).toContain("newcreator");
    expect(store.state.monitors).toHaveLength(1);
  });

  test("POST /watch resolves urls and room ids", async () => {
    const { app } = setup();
    await form(app, "/watch", "POST", {
      target: "https://www.tiktok.com/@urlcreator/live",
    });
    await form(app, "/watch", "POST", { target: "12345678" });
    const panel = await (await get(app, "/partials/users")).text();
    expect(panel).toContain("@urlcreator");
    expect(panel).toContain("12345678");
  });

  test("POST /watch with an empty target keeps a 200 and shows a notice", async () => {
    const { app, store } = setup();
    const response = await form(app, "/watch", "POST", { target: "   " });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("notice is-error");
    expect(store.state.monitors).toHaveLength(0);
  });

  test("POST /watch surfaces engine failures as a notice with a 200", async () => {
    const { app, engine } = setup();
    const real = engine.addMonitor.bind(engine);
    engine.addMonitor = async (): Promise<Monitor> => {
      throw new EngineError("boom", 400);
    };
    try {
      const response = await form(app, "/watch", "POST", { target: "someone" });
      expect(response.status).toBe(200);
      const panel = await response.text();
      expect(panel).toContain("notice is-error");
      expect(panel).toContain("boom");
    } finally {
      engine.addMonitor = real;
    }
  });

  test("rows expose every htmx action with explicit targets", async () => {
    const { app, engine } = setup();
    const monitor = await engine.addMonitor({ uniqueId: "actioncase" });
    const panel = await (await get(app, "/partials/users")).text();
    for (const marker of [
      `hx-post="/watch/${monitor.id}/check"`,
      `hx-post="/watch/${monitor.id}/record"`,
      `hx-delete="/watch/${monitor.id}"`,
      'hx-confirm="Remove @actioncase and stop any active recording?"',
      `hx-patch="/watch/${monitor.id}"`,
      'name="autoRecord"',
      'hx-trigger="change"',
      "chip is-muted",
      'class="watch-card"',
      'class="watch-grid"',
    ]) {
      expect(panel).toContain(marker);
    }
  });

  test("check returns 204 with a refresh trigger and flips the chip live", async () => {
    const { app, engine } = setup();
    const monitor = await engine.addMonitor({ uniqueId: "checkcase" });
    const response = await form(app, `/watch/${monitor.id}/check`, "POST", {});
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const sent = trigger(response);
    expect(sent.refreshUsers).toBe(true);
    const panel = await (await get(app, "/partials/users")).text();
    expect(panel).toContain("chip is-live");
    expect(panel).toContain("status-dot is-live");
  });

  test("auto checkbox parses on and off strings", async () => {
    const { app, engine, store } = setup();
    const monitor = await engine.addMonitor({
      uniqueId: "autocase",
      autoRecord: false,
    });
    let response = await form(app, `/watch/${monitor.id}`, "PATCH", {
      autoRecord: "on",
    });
    expect(response.status).toBe(204);
    expect(store.monitor(monitor.id)?.autoRecord).toBe(true);
    response = await form(app, `/watch/${monitor.id}`, "PATCH", {
      autoRecord: "off",
    });
    expect(response.status).toBe(204);
    expect(store.monitor(monitor.id)?.autoRecord).toBe(false);
  });

  test("quality select patches the variant", async () => {
    const { app, engine, store } = setup();
    const monitor = await engine.addMonitor({ uniqueId: "qualitycase" });
    const response = await form(app, `/watch/${monitor.id}`, "PATCH", {
      variant: "audio",
    });
    expect(response.status).toBe(204);
    expect(store.monitor(monitor.id)?.variant).toBe("audio");
    expect(JSON.stringify(trigger(response))).toContain("audio");
  });

  test("record then stop flips the action to Stop and back", async () => {
    const { app, engine } = setup();
    const monitor = await engine.addMonitor({ uniqueId: "reccase" });
    expect(
      (await form(app, `/watch/${monitor.id}/record`, "POST", {})).status,
    ).toBe(204);
    let panel = await (await get(app, "/partials/users")).text();
    expect(panel).toContain("chip is-recording");
    expect(panel).toContain(`/watch/${monitor.id}/stop`);
    expect(
      (await form(app, `/watch/${monitor.id}/stop`, "POST", {})).status,
    ).toBe(204);
    panel = await (await get(app, "/partials/users")).text();
    expect(panel).not.toContain(`/watch/${monitor.id}/stop`);
  });

  test("columns group monitors by bucket", async () => {
    const { app, engine } = setup();
    await engine.addMonitor({ uniqueId: "offcase" });
    const live = await engine.addMonitor({ uniqueId: "livecase" });
    await engine.check(live.id);
    const recording = await engine.addMonitor({ uniqueId: "reccase" });
    await engine.recordNow(recording.id);
    const panel = await (await get(app, "/partials/users")).text();
    const segments = panel.split('<section class="watch-column"');
    expect(segments).toHaveLength(4);
    const [, offlineCol, liveCol, recordingCol] = segments;
    expect(offlineCol).toContain("<h2>Offline</h2>");
    expect(liveCol).toContain("<h2>Live</h2>");
    expect(recordingCol).toContain("<h2>Recording</h2>");
    expect(offlineCol).toContain("@offcase");
    expect(offlineCol).not.toContain("@livecase");
    expect(offlineCol).not.toContain("@reccase");
    expect(liveCol).toContain("@livecase");
    expect(liveCol).not.toContain("@offcase");
    expect(liveCol).not.toContain("@reccase");
    expect(recordingCol).toContain("@reccase");
    expect(recordingCol).not.toContain("@offcase");
    expect(recordingCol).not.toContain("@livecase");
  });

  test("delete removes the monitor and toasts", async () => {
    const { app, engine, store } = setup();
    const monitor = await engine.addMonitor({ uniqueId: "delcase" });
    const response = await app.handle(
      new Request(`http://localhost/watch/${monitor.id}`, { method: "DELETE" }),
    );
    expect(response.status).toBe(204);
    expect(JSON.stringify(trigger(response))).toContain("delcase");
    expect(store.monitor(monitor.id)).toBeUndefined();
  });

  test("unknown monitor ids 404 on row actions", async () => {
    const { app } = setup();
    expect((await form(app, "/watch/nope/check", "POST", {})).status).toBe(404);
    expect(
      (await form(app, "/watch/nope", "PATCH", { variant: "hd" })).status,
    ).toBe(404);
    expect(
      (
        await app.handle(
          new Request("http://localhost/watch/nope", { method: "DELETE" }),
        )
      ).status,
    ).toBe(404);
  });

  test("toast headers stay Latin-1 so Bun serves them over HTTP", async () => {
    const { app, engine } = setup();
    const monitor = await engine.addMonitor({ uniqueId: "headercase" });
    for (const response of [
      await form(app, `/watch/${monitor.id}/check`, "POST", {}),
      await form(app, `/watch/${monitor.id}`, "PATCH", { variant: "hd" }),
    ]) {
      const raw = response.headers.get("HX-Trigger") ?? "";
      expect(raw).toMatch(/^[\x20-\x7E]*$/);
      expect(
        () =>
          new Response(null, { status: 204, headers: { "HX-Trigger": raw } }),
      ).not.toThrow();
    }
  });

  test("a hostile handle renders inert", async () => {
    const { app, store } = setup();
    store.state.monitors.push({
      id: "mon-xss",
      uniqueId: '<script>alert("x")</script>',
      roomId: null,
      variant: "best",
      autoRecord: false,
      intervalSec: 180,
      maxDurationSec: null,
      state: "waiting",
      live: false,
      title: "",
      viewers: 0,
      avatarUrl: null,
      lastCheckedAt: null,
      lastError: null,
      recordingId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const panel = await (await get(app, "/watch")).text();
    expect(panel).not.toContain("<script>alert");
    expect(panel).toContain("&lt;script&gt;");
  });
});
