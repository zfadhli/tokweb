import { describe, expect, test } from "bun:test";
import type { Monitor, Recording } from "../src/core/types";
import {
  baseName,
  displayHandle,
  elapsedMs,
  fmtBytes,
  fmtDate,
  fmtDuration,
  initials,
  isPlayable,
  monitorStatus,
  plural,
} from "../src/server/view";

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: "m1",
    uniqueId: "streamer",
    roomId: null,
    variant: "best",
    autoRecord: true,
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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: "r1",
    monitorId: "m1",
    uniqueId: "streamer",
    roomId: null,
    title: "Set",
    variant: "best",
    state: "completed",
    file: "streamer_20260707_140509.mp4",
    startedAt: 1_000,
    endedAt: 61_000,
    durationMs: 60_000,
    bytes: 2_048,
    error: null,
    ...overrides,
  };
}

describe("view formatting", () => {
  test("bytes scale and never show negative values", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(-10)).toBe("0 B");
    expect(fmtBytes(900)).toBe("900 B");
    expect(fmtBytes(2_048)).toBe("2.0 KB");
    expect(fmtBytes(1_572_864)).toBe("1.5 MB");
  });

  test("durations drop the hour field below an hour", () => {
    expect(fmtDuration(0)).toBe("00:00");
    expect(fmtDuration(9_000)).toBe("00:09");
    expect(fmtDuration(125_000)).toBe("02:05");
    expect(fmtDuration(3_725_000)).toBe("1:02:05");
  });

  test("dates render day, month, and 24h time", () => {
    expect(fmtDate(new Date(2026, 6, 7, 14, 5).getTime())).toBe("7 Jul, 14:05");
  });

  test("initials fall back to a question mark", () => {
    expect(initials("@aurora_beats")).toBe("AU");
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
  });

  test("plural and file helpers", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "file")).toBe("2 files");
    expect(plural(2, "process", "processes")).toBe("2 processes");
    expect(baseName("a/b/streamer_20260707_140509.mp4")).toBe(
      "streamer_20260707_140509.mp4",
    );
    expect(baseName(null)).toBe("recording.mp4");
  });
});

describe("monitor status", () => {
  test("recording and error outrank live", () => {
    expect(monitorStatus(monitor({ state: "recording", live: true }))).toEqual({
      label: "recording",
      kind: "recording",
    });
    expect(monitorStatus(monitor({ state: "error", live: true }))).toEqual({
      label: "error",
      kind: "error",
    });
    expect(monitorStatus(monitor({ state: "checking" }))).toEqual({
      label: "checking",
      kind: "checking",
    });
    expect(monitorStatus(monitor({ state: "live", live: true }))).toEqual({
      label: "live",
      kind: "live",
    });
    expect(monitorStatus(monitor({ state: "waiting" }))).toEqual({
      label: "idle",
      kind: "idle",
    });
    expect(monitorStatus(monitor({ state: "idle" }))).toEqual({
      label: "standby",
      kind: "standby",
    });
  });

  test("handle prefers the username", () => {
    expect(displayHandle({ uniqueId: "streamer", roomId: "7" })).toBe(
      "streamer",
    );
    expect(displayHandle({ uniqueId: null, roomId: "7" })).toBe("7");
    expect(displayHandle({ uniqueId: null, roomId: null })).toBe("unknown");
  });
});

describe("recordings", () => {
  test("playable follows the file, not the state", () => {
    expect(isPlayable(recording())).toBe(true);
    expect(isPlayable(recording({ state: "cancelled" }))).toBe(true);
    expect(isPlayable(recording({ state: "failed" }))).toBe(true);
    expect(isPlayable(recording({ file: null }))).toBe(false);
    expect(isPlayable(recording({ file: "streamer_20260707_140509.ts" }))).toBe(
      false,
    );
  });

  test("elapsed grows for unfinished recordings and freezes when ended", () => {
    expect(elapsedMs(recording(), 61_000)).toBe(60_000);
    expect(elapsedMs(recording({ endedAt: null, durationMs: 0 }), 61_000)).toBe(
      60_000,
    );
  });
});
