import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveRoom, ResolveInput } from "../src/core/types";
import type { LiveResolver } from "../src/tiktok/client";
import type {
  RecorderFactory,
  RecorderHandle,
  RecorderOptions,
  RecorderResult,
} from "../src/recorder/ffmpeg";

export function tempDir(prefix = "tokweb-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export class FakeResolver implements LiveResolver {
  room: LiveRoom;
  calls = 0;
  callTimes: number[] = [];
  error: Error | null = null;
  /** Hold each lookup open this long, to make concurrency observable. */
  delayMs = 0;
  active = 0;
  maxActive = 0;

  constructor(room: LiveRoom) {
    this.room = room;
  }

  async resolve(_input: ResolveInput): Promise<LiveRoom> {
    this.calls += 1;
    this.callTimes.push(Date.now());
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs > 0) {
        await new Promise((done) => setTimeout(done, this.delayMs));
      }
      if (this.error) throw this.error;
      return this.room;
    } finally {
      this.active -= 1;
    }
  }
}

export interface FakeRecorderControl {
  options: RecorderOptions;
  finish(result?: Partial<RecorderResult>): void;
  stopped: boolean;
}

export function fakeRecorderFactory(): {
  factory: RecorderFactory;
  handles: FakeRecorderControl[];
} {
  const handles: FakeRecorderControl[] = [];
  const factory: RecorderFactory = (options) => {
    let settle: (result: RecorderResult) => void = () => undefined;
    const done = new Promise<RecorderResult>((resolve) => {
      settle = resolve;
    });
    let finished = false;
    const finish = (result: Partial<RecorderResult> = {}): void => {
      if (finished) return;
      finished = true;
      settle({
        ok: true,
        file: `${options.outputBase}.mp4`,
        sourceFile: `${options.outputBase}.ts`,
        bytes: 2048,
        durationMs: 5_000,
        code: 0,
        error: null,
        ...result,
      });
    };
    const control: FakeRecorderControl = {
      options,
      finish,
      stopped: false,
    };
    handles.push(control);
    return {
      sourcePath: `${options.outputBase}.ts`,
      stop: async () => {
        control.stopped = true;
        finish();
        return done;
      },
      done,
    } satisfies RecorderHandle;
  };
  return { factory, handles };
}

export function liveRoom(overrides: Partial<LiveRoom> = {}): LiveRoom {
  return {
    status: "live",
    uniqueId: "streamer",
    nickname: "Test Streamer",
    avatarUrl: null,
    roomId: "7000000000000000001",
    title: "Clean-room test stream",
    viewers: 1234,
    streams: [
      {
        url: "https://cdn.example.com/live/hd.flv",
        format: "flv",
        quality: "HD",
      },
      {
        url: "https://cdn.example.com/live/sd.flv",
        format: "flv",
        quality: "SD",
      },
    ],
    ...overrides,
  };
}
