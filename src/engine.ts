import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileBase } from './core/naming'
import type {
  LiveRoom,
  Monitor,
  MonitorInput,
  MonitorMode,
  Recording,
  Variant,
  Result,
} from './core/types'
import { MONITOR_MODES, VARIANTS } from './core/types'
import type { LiveResolver } from './tiktok/client'
import { normalizeInput, selectSource } from './tiktok/client'
import { startRecorder, type RecorderFactory, type RecorderHandle, type RecorderResult } from './recorder/ffmpeg'
import type { Store } from './store'

export interface ActivityEvent {
  id: string
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export class EngineError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'EngineError'
    this.status = status
  }
}

interface Active {
  key: string
  recordingId: string
  monitorId: string | null
  handle: RecorderHandle
  timer: ReturnType<typeof setTimeout> | null
  cancelled: boolean
}

export interface EngineOptions {
  recorder?: RecorderFactory
  now?: () => number
  followLimit?: number
}

export class Engine {
  private readonly store: Store
  private readonly resolver: LiveResolver
  private readonly recorder: RecorderFactory
  private readonly now: () => number
  private readonly followLimit: number
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly active = new Map<string, Active>()
  private readonly byRecording = new Map<string, Active>()
  private readonly events: ActivityEvent[] = []
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private dirty = false
  private stopped = true

  constructor(store: Store, resolver: LiveResolver, options: EngineOptions = {}) {
    this.store = store
    this.resolver = resolver
    this.recorder = options.recorder ?? startRecorder
    this.now = options.now ?? Date.now
    this.followLimit = options.followLimit ?? 10
  }

  start(): void {
    this.stopped = false
    let repaired = false
    for (const monitor of this.store.state.monitors) {
      if (monitor.state === 'recording' || monitor.state === 'checking') {
        monitor.state = monitor.mode === 'manual' ? 'idle' : 'waiting'
        monitor.recordingId = null
        repaired = true
      }
      if (monitor.mode !== 'manual' && monitor.state !== 'stopped') this.schedule(monitor.id, 0)
    }
    if (repaired) this.store.save()
    this.progressTimer = setInterval(() => {
      if (this.active.size > 0 && this.dirty) {
        this.dirty = false
        this.store.save()
      }
    }, 3_000)
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    if (this.progressTimer) clearInterval(this.progressTimer)
    this.progressTimer = null
    await Promise.all([...this.active.values()].map((item) => item.handle.stop().catch(() => undefined)))
    this.store.save()
  }

  get activeCount(): number {
    return this.active.size
  }

  get activity(): readonly ActivityEvent[] {
    return this.events
  }

  async addMonitor(input: MonitorInput): Promise<Monitor> {
    const { uniqueId, roomId } = normalizeInput(input)
    if (!uniqueId && !roomId) {
      throw new EngineError('Provide a username, live URL, or room id.', 400)
    }
    const mode = parseMode(input.mode)
    if (mode === 'followers' && !uniqueId) {
      throw new EngineError('Followers mode needs a TikTok username (not a room id).', 400)
    }
    const variant = parseVariant(input.variant, this.store.state.settings.defaultVariant)
    const intervalSec = clampInt(input.intervalSec, 10, 86_400, this.store.state.settings.defaultIntervalSec)
    const maxDurationSec =
      input.maxDurationSec === null || input.maxDurationSec === 0
        ? null
        : clampInt(input.maxDurationSec, 5, 86_400, 0) || null

    const existing = this.store.state.monitors.find(
      (monitor) =>
        (uniqueId && monitor.uniqueId?.toLowerCase() === uniqueId.toLowerCase()) ||
        (roomId && monitor.roomId === roomId),
    )
    if (existing) {
      existing.mode = mode
      existing.variant = variant
      existing.intervalSec = intervalSec
      existing.maxDurationSec = maxDurationSec
      if (input.autoRecord !== undefined) existing.autoRecord = input.autoRecord
      existing.updatedAt = this.now()
      this.store.save()
      this.reschedule(existing)
      return existing
    }

    const at = this.now()
    const monitor: Monitor = {
      id: Bun.randomUUIDv7(),
      uniqueId,
      roomId,
      mode,
      variant,
      autoRecord: input.autoRecord ?? mode !== 'manual',
      intervalSec,
      maxDurationSec,
      state: 'idle',
      live: false,
      title: '',
      viewers: 0,
      avatarUrl: null,
      lastCheckedAt: null,
      lastError: null,
      recordingId: null,
      createdAt: at,
      updatedAt: at,
    }
    this.store.state.monitors.push(monitor)
    this.store.save()
    this.log('info', `Added @${uniqueId ?? roomId} · ${mode}`)
    this.reschedule(monitor)
    return monitor
  }

  updateMonitor(
    id: string,
    patch: {
      autoRecord?: boolean
      variant?: Variant
      intervalSec?: number
      maxDurationSec?: number | null
      mode?: MonitorMode
    },
  ): Monitor {
    const monitor = this.store.monitor(id)
    if (!monitor) throw new EngineError('Monitor not found.', 404)
    if (patch.mode) {
      if (patch.mode === 'followers' && !monitor.uniqueId) {
        throw new EngineError('Followers mode needs a username.', 400)
      }
      monitor.mode = patch.mode
    }
    if (patch.variant) monitor.variant = parseVariant(patch.variant, monitor.variant)
    if (patch.intervalSec !== undefined) {
      monitor.intervalSec = clampInt(patch.intervalSec, 10, 86_400, monitor.intervalSec)
    }
    if (patch.maxDurationSec !== undefined) {
      const seconds = patch.maxDurationSec
      monitor.maxDurationSec =
        seconds === null ? null : clampInt(seconds, 5, 86_400, monitor.maxDurationSec ?? 0)
    }
    if (patch.autoRecord !== undefined) monitor.autoRecord = patch.autoRecord
    monitor.updatedAt = this.now()
    this.store.save()
    this.reschedule(monitor)
    return monitor
  }

  async removeMonitor(id: string): Promise<boolean> {
    const monitor = this.store.monitor(id)
    if (!monitor) return false
    this.clearTimer(id)
    for (const active of [...this.active.values()]) {
      if (active.monitorId === id) await this.stopActive(active)
    }
    this.store.state.monitors = this.store.state.monitors.filter((item) => item.id !== id)
    this.store.save()
    this.log('info', `Removed @${monitor.uniqueId ?? monitor.roomId}`)
    return true
  }

  async check(id: string): Promise<Monitor> {
    const monitor = this.store.monitor(id)
    if (!monitor) throw new EngineError('Monitor not found.', 404)
    monitor.state = 'checking'
    monitor.lastError = null
    try {
      if (monitor.mode === 'followers') {
        const following = await this.resolver.following(monitor.uniqueId ?? '')
        monitor.title = `${following.length} following`
        monitor.live = following.length > 0
        monitor.state = following.length > 0 ? 'live' : 'waiting'
      } else {
        const room = await this.resolveMonitor(monitor)
        this.applyRoom(monitor, room)
      }
    } catch (error) {
      this.failMonitor(monitor, error)
      this.store.save()
      throw error
    }
    monitor.lastCheckedAt = this.now()
    monitor.updatedAt = this.now()
    this.store.save()
    return monitor
  }

  async recordNow(id: string): Promise<Recording> {
    const monitor = this.store.monitor(id)
    if (!monitor) throw new EngineError('Monitor not found.', 404)
    const room = await this.resolveMonitor(monitor)
    this.applyRoom(monitor, room)
    if (room.status !== 'live') {
      this.store.save()
      throw new EngineError(`@${room.uniqueId} is not live right now.`, 409)
    }
    return this.begin(monitor, room)
  }

  async stopRecording(id: string): Promise<Recording | null> {
    const active =
      this.byRecording.get(id) ??
      [...this.active.values()].find((item) => item.monitorId === id) ??
      [...this.active.values()].find((item) => item.key === id.toLowerCase())
    if (!active) return null
    active.cancelled = true
    await this.stopActive(active)
    return this.store.recording(active.recordingId) ?? null
  }

  private async stopActive(active: Active): Promise<void> {
    active.cancelled = true
    try {
      await active.handle.stop()
    } catch {
      // finalizeReporting already recorded the failure.
    }
  }

  private async tick(id: string): Promise<void> {
    this.timers.delete(id)
    if (this.stopped) return
    const monitor = this.store.monitor(id)
    if (!monitor || monitor.mode === 'manual') return

    try {
      if (this.activeForMonitor(id)) {
        monitor.state = 'recording'
      } else if (monitor.mode === 'followers') {
        await this.tickFollowers(monitor)
      } else {
        await this.tickAutomatic(monitor)
      }
    } catch (error) {
      this.failMonitor(monitor, error)
    } finally {
      monitor.updatedAt = this.now()
      if (this.store.monitor(id)) {
        this.store.save()
        if (!this.stopped) this.schedule(id, monitor.intervalSec * 1_000)
      }
    }
  }

  private async tickAutomatic(monitor: Monitor): Promise<void> {
    monitor.state = 'checking'
    monitor.lastError = null
    const room = await this.resolveMonitor(monitor)
    this.applyRoom(monitor, room)
    if (room.status === 'live' && monitor.autoRecord) {
      await this.begin(monitor, room)
    } else {
      monitor.state = room.status === 'live' ? 'live' : 'waiting'
    }
  }

  private async tickFollowers(monitor: Monitor): Promise<void> {
    monitor.state = 'checking'
    monitor.lastError = null
    const following = await this.resolver.following(monitor.uniqueId ?? '')
    monitor.lastCheckedAt = this.now()
    let liveCount = 0
    let started = 0
    for (const user of following.slice(0, this.followLimit)) {
      if (this.byUser(user.uniqueId)) {
        liveCount += 1
        continue
      }
      try {
        const room = await this.resolver.resolve({ uniqueId: user.uniqueId })
        if (room.status !== 'live') continue
        liveCount += 1
        if (monitor.autoRecord && started < 3) {
          await this.begin(monitor, room)
          started += 1
        }
      } catch (error) {
        this.log('warn', `@${user.uniqueId}: ${errorMessage(error)}`)
      }
    }
    monitor.live = liveCount > 0
    monitor.title = `${following.length} following · ${liveCount} live`
    monitor.viewers = liveCount
    monitor.state = liveCount > 0 ? 'live' : 'waiting'
  }

  private async begin(monitor: Monitor, room: LiveRoom): Promise<Recording> {
    const key = room.uniqueId.toLowerCase()
    const existing = this.byUser(room.uniqueId)
    if (existing) return this.store.recording(existing.recordingId) as Recording

    const source = selectSource(room, monitor.variant)
    if (!source) throw new EngineError(`No ${monitor.variant} stream URL for @${room.uniqueId}.`, 409)

    const at = this.now()
    const settings = this.store.state.settings
    const base = this.availableBase(settings.outputDir, fileBase(room.uniqueId, room.roomId, at))
    const recording: Recording = {
      id: Bun.randomUUIDv7(),
      monitorId: monitor.id,
      uniqueId: room.uniqueId,
      roomId: room.roomId,
      title: room.title,
      variant: monitor.variant,
      state: 'starting',
      file: null,
      startedAt: at,
      endedAt: null,
      durationMs: 0,
      bytes: 0,
      error: null,
    }
    this.store.state.recordings.unshift(recording)

    let handle: RecorderHandle
    try {
      handle = this.recorder({
        url: source.url,
        outputBase: base,
        ffmpegPath: settings.ffmpegPath,
        durationSec: monitor.maxDurationSec,
        bitrate: settings.bitrate || null,
        proxy: settings.proxy,
        userAgent: settings.userAgent,
        keepFlv: settings.keepFlv,
        audioOnly: monitor.variant === 'audio',
        onProgress: (progress) => {
          recording.bytes = progress.bytes
          recording.durationMs = progress.durationMs
          this.dirty = true
        },
      })
    } catch (error) {
      recording.state = 'failed'
      recording.error = errorMessage(error)
      this.failMonitor(monitor, error)
      this.store.save()
      throw error
    }

    recording.state = 'recording'
    monitor.recordingId = recording.id
    monitor.state = 'recording'
    monitor.live = true
    monitor.title = room.title
    monitor.viewers = room.viewers
    monitor.lastCheckedAt = at
    monitor.updatedAt = at

    const active: Active = {
      key,
      recordingId: recording.id,
      monitorId: monitor.id,
      handle,
      timer: null,
      cancelled: false,
    }
    if (monitor.maxDurationSec) {
      active.timer = setTimeout(() => {
        active.cancelled = false
        void this.stopActive(active)
      }, monitor.maxDurationSec * 1_000 + 2_000)
    }
    this.active.set(key, active)
    this.byRecording.set(recording.id, active)
    this.log('info', `Recording @${room.uniqueId} · ${source.quality} ${source.format}`)
    this.store.save()

    void handle.done
      .then((result) => this.finalize(active, result))
      .catch((error: unknown) => {
        void this.finalize(active, {
          ok: false,
          file: null,
          flvFile: null,
          bytes: 0,
          durationMs: 0,
          code: null,
          error: errorMessage(error),
        })
      })

    return recording
  }

  private finalize(active: Active, result: RecorderResult): void {
    if (active.timer) clearTimeout(active.timer)
    this.active.delete(active.key)
    this.byRecording.delete(active.recordingId)

    const recording = this.store.recording(active.recordingId)
    if (!recording) return
    const endedAt = this.now()
    recording.endedAt = endedAt
    recording.durationMs = result.durationMs || Math.max(0, endedAt - recording.startedAt)
    recording.bytes = result.bytes
    recording.state = active.cancelled ? 'cancelled' : result.ok ? 'completed' : 'failed'
    recording.error = result.error
    recording.file = result.file ? basename(result.file) : null

    const monitor = active.monitorId ? this.store.monitor(active.monitorId) : undefined
    if (monitor) {
      monitor.recordingId = null
      monitor.state = recording.state === 'failed' ? 'error' : monitor.mode === 'manual' ? 'idle' : 'waiting'
      if (recording.state === 'failed') monitor.lastError = result.error
      monitor.updatedAt = endedAt
    }
    this.log(
      recording.state === 'failed' ? 'error' : 'info',
      `${recording.state} @${recording.uniqueId} · ${formatBytes(result.bytes)}${result.error ? ` · ${result.error}` : ''}`,
    )
    this.dirty = false
    this.store.save()
  }

  private applyRoom(monitor: Monitor, room: LiveRoom): void {
    monitor.live = room.status === 'live'
    monitor.title = room.title
    monitor.viewers = room.viewers
    monitor.avatarUrl = room.avatarUrl ?? monitor.avatarUrl
    monitor.lastCheckedAt = this.now()
    monitor.lastError = null
    monitor.state = room.status === 'live' ? 'live' : 'waiting'
    if (!monitor.uniqueId && room.uniqueId) monitor.uniqueId = room.uniqueId
    if (!monitor.roomId && room.roomId) monitor.roomId = room.roomId
  }

  private resolveMonitor(monitor: Monitor): Promise<LiveRoom> {
    return this.resolver.resolve({ uniqueId: monitor.uniqueId, roomId: monitor.roomId })
  }

  private failMonitor(monitor: Monitor, error: unknown): void {
    monitor.state = 'error'
    monitor.lastError = errorMessage(error)
    monitor.lastCheckedAt = this.now()
    this.log('error', `@${monitor.uniqueId ?? monitor.roomId}: ${monitor.lastError}`)
  }

  private byUser(uniqueId: string): Active | undefined {
    return this.active.get(uniqueId.toLowerCase())
  }

  private activeForMonitor(id: string): Active | undefined {
    return [...this.active.values()].find((item) => item.monitorId === id)
  }

  private reschedule(monitor: Monitor): void {
    this.clearTimer(monitor.id)
    if (monitor.mode !== 'manual' && !this.stopped) this.schedule(monitor.id, 0)
  }

  private schedule(id: string, delay: number): void {
    this.clearTimer(id)
    this.timers.set(
      id,
      setTimeout(() => {
        void this.tick(id)
      }, delay),
    )
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }

  private availableBase(dir: string, base: string): string {
    let candidate = base
    let counter = 2
    while (['flv', 'mp4', 'm4a'].some((ext) => existsSync(join(dir, `${candidate}.${ext}`)))) {
      candidate = `${base}-${counter}`
      counter += 1
    }
    return join(dir, candidate)
  }

  private log(level: ActivityEvent['level'], message: string): void {
    this.events.unshift({ id: Bun.randomUUIDv7(), at: this.now(), level, message })
    if (this.events.length > 100) this.events.length = 100
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function parseVariant(value: Variant | undefined, fallback: Variant): Variant {
  return value && VARIANTS.includes(value) ? value : fallback
}

function parseMode(value: MonitorMode | undefined): MonitorMode {
  return value && MONITOR_MODES.includes(value) ? value : 'manual'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`
}

/** Small helper for CLI/tests that want a Result instead of an exception. */
export async function tryResolve(
  resolver: LiveResolver,
  input: Parameters<LiveResolver['resolve']>[0],
): Promise<Result<LiveRoom>> {
  try {
    return { ok: true, value: await resolver.resolve(input) }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}
