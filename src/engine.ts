import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileBase } from "./core/naming";
import type {
  LiveRoom,
  Monitor,
  MonitorInput,
  Recording,
  Variant,
  Result,
} from "./core/types";
import { VARIANTS } from "./core/types";
import type { LiveResolver } from "./tiktok/client";
import { TikTokError, normalizeInput, selectSource } from "./tiktok/client";
import {
  startRecorder,
  type RecorderFactory,
  type RecorderHandle,
  type RecorderResult,
} from "./recorder/ffmpeg";
import type { Store } from "./store";

const BOOT_STAGGER_WINDOW_MS = 45_000; // total spread is capped so a large watchlist still gets checked in under a minute.
const BLOCK_BACKOFF_BASE_MS = 5 * 60_000;
const BLOCK_BACKOFF_MAX_MS = 30 * 60_000;

export class EngineError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EngineError";
    this.status = status;
  }
}

interface Active {
  key: string;
  recordingId: string;
  monitorId: string | null;
  handle: RecorderHandle;
  timer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

export interface EngineOptions {
  recorder?: RecorderFactory;
  now?: () => number;
  bootStaggerMs?: number;
  blockBackoffBaseMs?: number;
  blockBackoffMaxMs?: number;
  /** Cap on simultaneous lookups. A 77-monitor watchlist must not open 77 sockets. */
  lookupConcurrency?: number;
  random?: () => number;
}

export class Engine {
  private readonly store: Store;
  private readonly resolver: LiveResolver;
  private readonly recorder: RecorderFactory;
  private readonly now: () => number;
  private readonly bootStaggerMs: number;
  private readonly blockBackoffBaseMs: number;
  private readonly blockBackoffMaxMs: number;
  private readonly lookupConcurrency: number;
  private readonly random: () => number;
  private lookupActive = 0;
  private readonly lookupQueue: Array<() => void> = [];
  private blockedUntil = 0;
  private blockStep = 0;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly awaitingFirstTick = new Set<string>();
  private bootSlot = 0;
  private readonly active = new Map<string, Active>();
  private readonly byRecording = new Map<string, Active>();
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private stopped = true;

  constructor(
    store: Store,
    resolver: LiveResolver,
    options: EngineOptions = {},
  ) {
    this.store = store;
    this.resolver = resolver;
    this.recorder = options.recorder ?? startRecorder;
    this.now = options.now ?? Date.now;
    this.bootStaggerMs = options.bootStaggerMs ?? 1_500;
    this.blockBackoffBaseMs =
      options.blockBackoffBaseMs ?? BLOCK_BACKOFF_BASE_MS;
    this.blockBackoffMaxMs = options.blockBackoffMaxMs ?? BLOCK_BACKOFF_MAX_MS;
    this.lookupConcurrency = Math.max(1, options.lookupConcurrency ?? 3);
    this.random = options.random ?? Math.random;
  }

  start(): void {
    this.stopped = false;
    let repaired = false;
    const sweepTotal = this.store.state.monitors.filter(
      (monitor) => monitor.state !== "stopped",
    ).length;
    for (const monitor of this.store.state.monitors) {
      if (monitor.state === "recording" || monitor.state === "checking") {
        monitor.state = "waiting";
        monitor.recordingId = null;
        repaired = true;
      }
      if (monitor.state !== "stopped") {
        this.scheduleFirstCheck(monitor.id, sweepTotal);
      }
    }
    if (repaired) this.store.save();
    this.progressTimer = setInterval(() => {
      if (this.active.size > 0 && this.dirty) {
        this.dirty = false;
        this.store.save();
      }
    }, 3_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
    await Promise.all(
      [...this.active.values()].map((item) =>
        item.handle.stop().catch(() => undefined),
      ),
    );
    this.store.save();
  }

  get activeCount(): number {
    return this.active.size;
  }

  async addMonitor(input: MonitorInput): Promise<Monitor> {
    const { uniqueId, roomId } = normalizeInput(input);
    if (!uniqueId && !roomId) {
      throw new EngineError("Provide a username, live URL, or room id.", 400);
    }
    const variant = parseVariant(
      input.variant,
      this.store.state.settings.defaultVariant,
    );
    const intervalSec = clampInt(
      input.intervalSec,
      10,
      86_400,
      this.store.state.settings.defaultIntervalSec,
    );
    const maxDurationSec =
      input.maxDurationSec === null || input.maxDurationSec === 0
        ? null
        : clampInt(
            input.maxDurationSec,
            5,
            86_400,
            this.store.state.settings.defaultMaxDurationSec,
          ) || null;

    const existing = this.store.state.monitors.find(
      (monitor) =>
        (uniqueId &&
          monitor.uniqueId?.toLowerCase() === uniqueId.toLowerCase()) ||
        (roomId && monitor.roomId === roomId),
    );
    if (existing) {
      existing.variant = variant;
      existing.intervalSec = intervalSec;
      existing.maxDurationSec = maxDurationSec;
      if (input.autoRecord !== undefined)
        existing.autoRecord = input.autoRecord;
      existing.updatedAt = this.now();
      this.store.save();
      this.reschedule(existing);
      return existing;
    }

    const at = this.now();
    const monitor: Monitor = {
      id: Bun.randomUUIDv7(),
      uniqueId,
      roomId,
      variant,
      autoRecord: input.autoRecord ?? false,
      intervalSec,
      maxDurationSec,
      state: "idle",
      live: false,
      title: "",
      viewers: 0,
      avatarUrl: null,
      lastCheckedAt: null,
      lastError: null,
      recordingId: null,
      createdAt: at,
      updatedAt: at,
    };
    this.store.state.monitors.push(monitor);
    this.store.save();
    this.reschedule(monitor);
    return monitor;
  }

  updateMonitor(
    id: string,
    patch: {
      autoRecord?: boolean;
      variant?: Variant;
      intervalSec?: number;
      maxDurationSec?: number | null;
    },
  ): Monitor {
    const monitor = this.store.monitor(id);
    if (!monitor) throw new EngineError("Monitor not found.", 404);
    if (patch.variant)
      monitor.variant = parseVariant(patch.variant, monitor.variant);
    if (patch.intervalSec !== undefined) {
      monitor.intervalSec = clampInt(
        patch.intervalSec,
        10,
        86_400,
        monitor.intervalSec,
      );
    }
    if (patch.maxDurationSec !== undefined) {
      const seconds = patch.maxDurationSec;
      monitor.maxDurationSec =
        seconds === null
          ? null
          : clampInt(seconds, 5, 86_400, monitor.maxDurationSec ?? 0);
    }
    if (patch.autoRecord !== undefined) monitor.autoRecord = patch.autoRecord;
    monitor.updatedAt = this.now();
    this.store.save();
    this.reschedule(monitor);
    return monitor;
  }

  async removeMonitor(id: string): Promise<boolean> {
    const monitor = this.store.monitor(id);
    if (!monitor) return false;
    this.clearTimer(id);
    this.forgetFirstCheck(id);
    for (const active of [...this.active.values()]) {
      if (active.monitorId === id) await this.stopActive(active);
    }
    this.store.state.monitors = this.store.state.monitors.filter(
      (item) => item.id !== id,
    );
    this.store.save();
    return true;
  }

  async check(id: string): Promise<Monitor> {
    const monitor = this.store.monitor(id);
    if (!monitor) throw new EngineError("Monitor not found.", 404);
    monitor.state = "checking";
    monitor.lastError = null;
    try {
      const room = await this.resolveMonitor(monitor);
      this.applyRoom(monitor, room);
    } catch (error) {
      this.failMonitor(monitor, error);
      this.store.save();
      throw error;
    }
    monitor.lastCheckedAt = this.now();
    monitor.updatedAt = this.now();
    this.store.save();
    return monitor;
  }

  async recordNow(id: string): Promise<Recording> {
    const monitor = this.store.monitor(id);
    if (!monitor) throw new EngineError("Monitor not found.", 404);
    const room = await this.resolveMonitor(monitor);
    this.applyRoom(monitor, room);
    if (room.status !== "live") {
      this.store.save();
      throw new EngineError(`@${room.uniqueId} is not live right now.`, 409);
    }
    return this.begin(monitor, room);
  }

  async stopRecording(id: string): Promise<Recording | null> {
    const active =
      this.byRecording.get(id) ??
      [...this.active.values()].find((item) => item.monitorId === id) ??
      [...this.active.values()].find((item) => item.key === id.toLowerCase());
    if (!active) return null;
    active.cancelled = true;
    await this.stopActive(active);
    return this.store.recording(active.recordingId) ?? null;
  }

  private async stopActive(active: Active): Promise<void> {
    active.cancelled = true;
    try {
      await active.handle.stop();
    } catch {
      // finalizeReporting already recorded the failure.
    }
  }

  private async tick(id: string): Promise<void> {
    this.timers.delete(id);
    this.forgetFirstCheck(id);
    if (this.stopped) return;
    const monitor = this.store.monitor(id);
    if (!monitor) return;
    if (this.now() < this.blockedUntil) {
      if (!this.stopped) this.schedule(id, this.blockedUntil - this.now());
      return;
    }

    try {
      if (this.activeForMonitor(id)) {
        monitor.state = "recording";
      } else {
        await this.tickAutomatic(monitor);
      }
    } catch (error) {
      // Only an API block silences every monitor. A challenged profile page
      // still leaves the JSON API working, and that API is what finds live rooms.
      if (
        error instanceof TikTokError &&
        error.kind === "blocked" &&
        error.source === "api"
      ) {
        const delay = Math.min(
          this.blockBackoffBaseMs * 2 ** this.blockStep,
          this.blockBackoffMaxMs,
        );
        this.blockedUntil = this.now() + delay;
        this.blockStep += 1;
      }
      this.failMonitor(monitor, error);
    } finally {
      monitor.updatedAt = this.now();
      if (this.store.monitor(id)) {
        this.store.save();
        if (!this.stopped) {
          if (this.blockedUntil > this.now()) {
            this.schedule(id, this.blockedUntil - this.now());
          } else {
            this.schedule(id, monitor.intervalSec * 1_000);
          }
        }
      }
    }
  }

  private async tickAutomatic(monitor: Monitor): Promise<void> {
    monitor.state = "checking";
    monitor.lastError = null;
    const room = await this.resolveMonitor(monitor);
    // Only a real lookup clears the block cooldown: a recording that keeps
    // ticking without a lookup must not reset the backoff for everyone else.
    this.blockStep = 0;
    this.blockedUntil = 0;
    this.applyRoom(monitor, room);
    if (room.status === "live" && monitor.autoRecord) {
      await this.begin(monitor, room);
    } else {
      monitor.state = room.status === "live" ? "live" : "waiting";
    }
  }

  private async begin(monitor: Monitor, room: LiveRoom): Promise<Recording> {
    const key = room.uniqueId.toLowerCase();
    const existing = this.byUser(room.uniqueId);
    if (existing)
      return this.store.recording(existing.recordingId) as Recording;

    const source = selectSource(room, monitor.variant);
    if (!source)
      throw new EngineError(
        `No ${monitor.variant} stream URL for @${room.uniqueId}.`,
        409,
      );

    const at = this.now();
    const settings = this.store.state.settings;
    const base = this.availableBase(
      settings.outputDir,
      fileBase(room.uniqueId, room.roomId, at),
    );
    const recording: Recording = {
      id: Bun.randomUUIDv7(),
      monitorId: monitor.id,
      uniqueId: room.uniqueId,
      roomId: room.roomId,
      title: room.title,
      variant: monitor.variant,
      state: "starting",
      file: null,
      startedAt: at,
      endedAt: null,
      durationMs: 0,
      bytes: 0,
      error: null,
    };
    this.store.state.recordings.unshift(recording);

    let handle: RecorderHandle;
    try {
      handle = this.recorder({
        url: source.url,
        outputBase: base,
        ffmpegPath: settings.ffmpegPath,
        durationSec: monitor.maxDurationSec,
        bitrate: settings.bitrate || null,
        proxy: settings.proxy,
        userAgent: settings.userAgent,
        keepSource: settings.keepSource,
        audioOnly: monitor.variant === "audio",
        onProgress: (progress) => {
          recording.bytes = progress.bytes;
          recording.durationMs = progress.durationMs;
          this.dirty = true;
        },
      });
    } catch (error) {
      recording.state = "failed";
      recording.error = errorMessage(error);
      this.failMonitor(monitor, error);
      this.store.save();
      throw error;
    }

    recording.state = "recording";
    monitor.recordingId = recording.id;
    monitor.state = "recording";
    monitor.live = true;
    monitor.title = room.title;
    monitor.viewers = room.viewers;
    monitor.lastCheckedAt = at;
    monitor.updatedAt = at;

    const active: Active = {
      key,
      recordingId: recording.id,
      monitorId: monitor.id,
      handle,
      timer: null,
      cancelled: false,
    };
    if (monitor.maxDurationSec) {
      active.timer = setTimeout(
        () => {
          active.cancelled = false;
          void this.stopActive(active);
        },
        monitor.maxDurationSec * 1_000 + 2_000,
      );
    }
    this.active.set(key, active);
    this.byRecording.set(recording.id, active);
    this.store.save();

    void handle.done
      .then((result) => this.finalize(active, result))
      .catch((error: unknown) => {
        void this.finalize(active, {
          ok: false,
          file: null,
          sourceFile: null,
          bytes: 0,
          durationMs: 0,
          code: null,
          error: errorMessage(error),
        });
      });

    return recording;
  }

  private finalize(active: Active, result: RecorderResult): void {
    if (active.timer) clearTimeout(active.timer);
    this.active.delete(active.key);
    this.byRecording.delete(active.recordingId);

    const recording = this.store.recording(active.recordingId);
    if (!recording) return;
    const endedAt = this.now();
    recording.endedAt = endedAt;
    recording.durationMs =
      result.durationMs || Math.max(0, endedAt - recording.startedAt);
    recording.bytes = result.bytes;
    recording.state = active.cancelled
      ? "cancelled"
      : result.ok
        ? "completed"
        : "failed";
    recording.error = result.error;
    recording.file = result.file ? basename(result.file) : null;

    const monitor = active.monitorId
      ? this.store.monitor(active.monitorId)
      : undefined;
    if (monitor) {
      monitor.recordingId = null;
      monitor.state = recording.state === "failed" ? "error" : "waiting";
      if (recording.state === "failed") monitor.lastError = result.error;
      monitor.updatedAt = endedAt;
    }
    this.dirty = false;
    this.store.save();
  }

  private applyRoom(monitor: Monitor, room: LiveRoom): void {
    monitor.live = room.status === "live";
    monitor.title = room.title;
    monitor.viewers = room.viewers;
    monitor.avatarUrl = room.avatarUrl ?? monitor.avatarUrl;
    monitor.lastCheckedAt = this.now();
    monitor.lastError = null;
    monitor.state = room.status === "live" ? "live" : "waiting";
    if (!monitor.uniqueId && room.uniqueId) monitor.uniqueId = room.uniqueId;
    if (!monitor.roomId && room.roomId) monitor.roomId = room.roomId;
  }

  private resolveMonitor(monitor: Monitor): Promise<LiveRoom> {
    return this.withLookupSlot(() =>
      this.resolver.resolve({
        uniqueId: monitor.uniqueId,
        roomId: monitor.roomId,
      }),
    );
  }

  /** FIFO gate: at most `lookupConcurrency` lookups in flight, rest wait their turn. */
  private async withLookupSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.lookupActive >= this.lookupConcurrency) {
      await new Promise<void>((admit) => this.lookupQueue.push(admit));
    }
    this.lookupActive += 1;
    try {
      return await task();
    } finally {
      this.lookupActive -= 1;
      this.lookupQueue.shift()?.();
    }
  }

  private failMonitor(monitor: Monitor, error: unknown): void {
    // A failed lookup says nothing about liveness, so drop the last known flag:
    // a monitor that cannot be checked belongs under Offline, not Live.
    monitor.live = false;
    monitor.state = "error";
    monitor.lastError = errorMessage(error);
    monitor.lastCheckedAt = this.now();
  }

  private byUser(uniqueId: string): Active | undefined {
    return this.active.get(uniqueId.toLowerCase());
  }

  private activeForMonitor(id: string): Active | undefined {
    return [...this.active.values()].find((item) => item.monitorId === id);
  }

  private reschedule(monitor: Monitor): void {
    this.clearTimer(monitor.id);
    if (!this.stopped) {
      this.scheduleFirstCheck(monitor.id, this.awaitingFirstTick.size + 1);
    }
  }

  private scheduleFirstCheck(id: string, total: number): void {
    const step =
      total > 1
        ? Math.min(this.bootStaggerMs, BOOT_STAGGER_WINDOW_MS / (total - 1))
        : this.bootStaggerMs;
    // Monotonic slot, not set size: a monitor added mid-sweep must not reuse a slot that already fired.
    const slot = this.bootSlot;
    this.bootSlot += 1;
    this.awaitingFirstTick.add(id);
    // Jitter keeps slots from landing on the same wall-clock instant when the
    // window cap makes them collide; the lookup semaphore does the real limiting.
    const jitter = 0.9 + this.random() * 0.2;
    this.schedule(id, Math.max(0, Math.round(slot * step * jitter)));
  }

  private forgetFirstCheck(id: string): void {
    this.awaitingFirstTick.delete(id);
    if (this.awaitingFirstTick.size === 0) this.bootSlot = 0;
  }

  private schedule(id: string, delay: number): void {
    this.clearTimer(id);
    this.timers.set(
      id,
      setTimeout(() => {
        void this.tick(id);
      }, delay),
    );
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private availableBase(dir: string, base: string): string {
    let candidate = base;
    let counter = 2;
    while (
      ["ts", "mp4", "m4a"].some((ext) =>
        existsSync(join(dir, `${candidate}.${ext}`)),
      )
    ) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }
    return join(dir, candidate);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function parseVariant(value: Variant | undefined, fallback: Variant): Variant {
  return value && VARIANTS.includes(value) ? value : fallback;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

/** Small helper for CLI/tests that want a Result instead of an exception. */
export async function tryResolve(
  resolver: LiveResolver,
  input: Parameters<LiveResolver["resolve"]>[0],
): Promise<Result<LiveRoom>> {
  try {
    return { ok: true, value: await resolver.resolve(input) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
