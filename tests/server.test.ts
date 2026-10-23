import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Engine } from "../src/engine";
import { createApp } from "../src/server";
import { Store } from "../src/store";
import { TikTokClient } from "../src/tiktok/client";
import type { Recording } from "../src/core/types";
import {
  FakeResolver,
  fakeRecorderFactory,
  liveRoom,
  tempDir,
} from "./helpers";

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return (await response.json()) as T;
}

function setup() {
  const dir = tempDir();
  const store = new Store({
    dataDir: join(dir, "data"),
    outputDir: join(dir, "out"),
  }).load();
  const resolver = new FakeResolver(liveRoom());
  const recorder = fakeRecorderFactory();
  const engine = new Engine(store, resolver, { recorder: recorder.factory });
  const client = new TikTokClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          statusCode: 0,
          data: {
            user: {
              uniqueId: "streamer",
              nickname: "Streamer",
              roomId: "7000000000000000001",
              status: 2,
            },
            liveRoom: {
              status: 2,
              roomId: "7000000000000000001",
              title: "Probe room",
              stats: { total_user: 7 },
              streamData: {
                pull_data: {
                  stream_data:
                    '{"data":{"main":{"flv":"https://cdn.example.com/probe.flv"}}}',
                },
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const app = createApp({ store, engine, client });
  return { dir, store, engine, app, client };
}

describe("HTTP API", () => {
  test("health and state expose no cookies", async () => {
    const { store, app } = setup();
    store.state.settings.cookies = "sessionid=secret";
    store.save();

    const health = await app.handle(new Request("http://localhost/api/health"));
    expect(health.status).toBe(200);
    expect((await json(health)).ok).toBe(true);

    const state = await app.handle(new Request("http://localhost/api/state"));
    const body = (await json(state)) as {
      settings: Record<string, unknown>;
      monitors: unknown[];
    };
    expect(body.settings.hasCookies).toBe(true);
    expect(body.settings.cookies).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body.monitors).toEqual([]);
  });

  test("monitor lifecycle: create, patch, check, stop, delete", async () => {
    const { app } = setup();
    const created = await app.handle(
      new Request("http://localhost/api/monitors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uniqueId: "streamer", variant: "best" }),
      }),
    );
    expect(created.status).toBe(201);
    const monitor = await json<{ id: string; uniqueId: string }>(created);
    expect(monitor.uniqueId).toBe("streamer");

    const patched = await app.handle(
      new Request(`http://localhost/api/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoRecord: true, intervalSec: 30 }),
      }),
    );
    expect(patched.status).toBe(200);
    expect((await json<{ autoRecord: boolean }>(patched)).autoRecord).toBe(
      true,
    );

    const checked = await app.handle(
      new Request(`http://localhost/api/monitors/${monitor.id}/check`, {
        method: "POST",
      }),
    );
    expect(checked.status).toBe(200);
    expect((await json<{ live: boolean }>(checked)).live).toBe(true);

    const recorded = await app.handle(
      new Request(`http://localhost/api/monitors/${monitor.id}/record`, {
        method: "POST",
      }),
    );
    expect(recorded.status).toBe(200);
    const recording = await json<{ id: string; state: string }>(recorded);
    expect(recording.state).toBe("recording");

    const stopped = await app.handle(
      new Request(`http://localhost/api/monitors/${monitor.id}/stop`, {
        method: "POST",
      }),
    );
    expect(stopped.status).toBe(200);
    expect(
      (await json<{ recording: { state: string } }>(stopped)).recording.state,
    ).toBe("cancelled");

    const removed = await app.handle(
      new Request(`http://localhost/api/monitors/${monitor.id}`, {
        method: "DELETE",
      }),
    );
    expect(removed.status).toBe(200);
    const state = (await json(
      await app.handle(new Request("http://localhost/api/state")),
    )) as {
      monitors: unknown[];
    };
    expect(state.monitors).toHaveLength(0);
  });

  test("probe resolves a live room and its best source", async () => {
    const { app } = setup();
    const response = await app.handle(
      new Request("http://localhost/api/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uniqueId: "streamer" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await json<{
      room: { status: string };
      source: { url: string };
    }>(response);
    expect(body.room.status).toBe("live");
    expect(body.source.url).toBe("https://cdn.example.com/probe.flv");
  });

  test("settings update masks cookies and validates interval", async () => {
    const { app, store } = setup();
    const response = await app.handle(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cookies: "sessionid=abc",
          defaultIntervalSec: 1,
          bitrate: "1M",
          outputDir: join(store.state.settings.outputDir, "nested"),
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as Record<string, unknown>;
    expect(body.hasCookies).toBe(true);
    expect(body.defaultIntervalSec).toBe(10);
    expect(body.bitrate).toBe("1M");
    expect(String(body.outputDir)).toEndWith("nested");
    expect(JSON.stringify(body)).not.toContain("sessionid");
  });

  test("recording files support range requests, download, and delete", async () => {
    const { store, app } = setup();
    const path = join(store.state.settings.outputDir, "clip.mp4");
    writeFileSync(path, "0123456789");
    const recording: Recording = {
      id: "clip",
      monitorId: null,
      uniqueId: "streamer",
      roomId: null,
      title: "Clip",
      variant: "best",
      state: "completed",
      file: "clip.mp4",
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
      bytes: 10,
      error: null,
    };
    store.state.recordings.push(recording);
    store.save();

    const ranged = await app.handle(
      new Request("http://localhost/api/recordings/clip/file", {
        headers: { range: "bytes=2-4" },
      }),
    );
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await ranged.text()).toBe("234");

    const download = await app.handle(
      new Request("http://localhost/api/recordings/clip/download"),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("clip.mp4");

    const removed = await app.handle(
      new Request("http://localhost/api/recordings/clip", { method: "DELETE" }),
    );
    expect(removed.status).toBe(200);
    expect(store.state.recordings).toHaveLength(0);
  });

  test("changing outputDir keeps existing files reachable", async () => {
    const { dir, store, app } = setup();
    const oldDir = store.state.settings.outputDir;
    writeFileSync(join(oldDir, "keep.mp4"), "keep-me");
    store.state.recordings.push({
      id: "keep",
      monitorId: null,
      uniqueId: "streamer",
      roomId: null,
      title: "",
      variant: "best",
      state: "completed",
      file: "keep.mp4",
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
      bytes: 7,
      error: null,
    });
    store.save();

    const response = await app.handle(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outputDir: join(dir, "next") }),
      }),
    );
    expect(response.status).toBe(200);
    expect(isAbsolute(store.state.recordings[0]?.file ?? "")).toBe(true);
    expect(
      await (
        await app.handle(
          new Request("http://localhost/api/recordings/keep/file"),
        )
      ).text(),
    ).toBe("keep-me");
  });

  test("SSE sends an immediate snapshot", async () => {
    const { app } = setup();
    const response = await app.handle(
      new Request("http://localhost/api/events"),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const chunk = await reader!.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("event: snapshot");
    expect(text).toContain('"monitors"');
    await reader!.cancel();
  });
});
