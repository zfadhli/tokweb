import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parseFileName } from './core/naming'
import type { AppState, Monitor, Recording, Settings } from './core/types'

export const DEFAULT_SETTINGS: Settings = {
  outputDir: 'recordings',
  ffmpegPath: 'ffmpeg',
  cookies: '',
  proxy: '',
  userAgent: '',
  defaultVariant: 'best',
  defaultIntervalSec: 180,
  defaultMaxDurationSec: 0,
  bitrate: '',
  keepSource: false,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** Filenames carry the start second; a live recording carries milliseconds. */
const SAME_CAPTURE_MS = 2_000

function sameCapture(left: Recording, right: { uniqueId: string; startedAt: number | null }): boolean {
  if (right.startedAt === null || left.uniqueId === 'unknown' || left.uniqueId !== right.uniqueId) return false
  return Math.abs(left.startedAt - right.startedAt) <= SAME_CAPTURE_MS
}

function loadedSettings(raw: unknown, fallback: Settings): Settings {
  const input = isRecord(raw) ? raw : {}
  const pick = <K extends keyof Settings>(key: K): Settings[K] => {
    const value = input[key]
    return (typeof value === typeof fallback[key] ? value : fallback[key]) as Settings[K]
  }
  return {
    outputDir: resolve(process.cwd(), pick('outputDir')),
    ffmpegPath: pick('ffmpegPath'),
    cookies: pick('cookies'),
    proxy: pick('proxy'),
    userAgent: pick('userAgent'),
    defaultVariant: pick('defaultVariant'),
    defaultIntervalSec: Math.max(10, Number(pick('defaultIntervalSec')) || 180),
    defaultMaxDurationSec: Math.min(86_400, Math.max(0, Math.round(Number(pick('defaultMaxDurationSec')) || 0))),
    bitrate: pick('bitrate'),
    keepSource: Boolean(pick('keepSource')),
  }
}

function loadedRecordings(raw: unknown): Recording[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is Recording => {
    if (!isRecord(item)) return false
    return typeof item.id === 'string' && typeof item.uniqueId === 'string' && typeof item.startedAt === 'number'
  })
}

function loadedMonitors(raw: unknown): Monitor[] {
  if (!Array.isArray(raw)) return []
  let legacy = 0
  const monitors = raw
    .filter(
      (item): item is Monitor =>
        isRecord(item) && typeof item.id === 'string' && typeof item.createdAt === 'number',
    )
    .map((item) => {
      if (!('mode' in item)) return item
      legacy += 1
      const copy = { ...item } as Monitor & { mode?: string }
      delete copy.mode
      return copy
    })
  if (legacy > 0) {
    console.warn(`tokweb: ${legacy} stored monitor(s) now use automatic polling.`)
  }
  return monitors
}

export class Store {
  readonly dataDir: string
  readonly statePath: string
  state: AppState

  constructor(options: { dataDir?: string; outputDir?: string } = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.TOKWEB_DATA ?? join(process.cwd(), 'data'))
    this.statePath = join(this.dataDir, 'state.json')
    const settings = {
      ...DEFAULT_SETTINGS,
      outputDir: resolve(process.cwd(), options.outputDir ?? DEFAULT_SETTINGS.outputDir),
    }
    this.state = { version: 1, settings, monitors: [], recordings: [] }
  }

  load(): this {
    mkdirSync(this.dataDir, { recursive: true })
    if (existsSync(this.statePath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(this.statePath, 'utf8'))
        const input = isRecord(parsed) ? parsed : {}
        this.state = {
          version: 1,
          settings: loadedSettings(input.settings, this.state.settings),
          monitors: loadedMonitors(input.monitors),
          recordings: loadedRecordings(input.recordings),
        }
      } catch (error) {
        const broken = `${this.statePath}.broken-${Date.now()}`
        try {
          renameSync(this.statePath, broken)
        } catch {
          // Keep going with defaults.
        }
        console.error(`tokweb: could not read state (${String(error)}), moved to ${broken}`)
      }
    }
    this.reconcile()
    this.save()
    return this
  }

  save(): void {
    mkdirSync(this.dataDir, { recursive: true })
    mkdirSync(this.state.settings.outputDir, { recursive: true })
    const tmp = `${this.statePath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2))
    renameSync(tmp, this.statePath)
  }

  monitor(id: string): Monitor | undefined {
    return this.state.monitors.find((item) => item.id === id)
  }

  recording(id: string): Recording | undefined {
    return this.state.recordings.find((item) => item.id === id)
  }

  /** Absolute path for a recording file, or null when it is missing/unsafe. */
  recordingPath(recording: Recording): string | null {
    if (!recording.file) return null
    const path = isAbsolute(recording.file)
      ? recording.file
      : join(this.state.settings.outputDir, basename(recording.file))
    return existsSync(path) ? path : null
  }

  /**
   * Bring the index in line with the disk: mark interrupted jobs failed and
   * adopt files that were recorded before a crash. Safe to run repeatedly.
   */
  reconcile(now = Date.now()): void {
    const { outputDir } = this.state.settings
    mkdirSync(outputDir, { recursive: true })

    for (const recording of this.state.recordings) {
      if (recording.state === 'starting' || recording.state === 'recording' || recording.state === 'finalizing') {
        recording.state = 'failed'
        recording.error = recording.error ?? 'Interrupted by server restart'
        recording.endedAt = recording.endedAt ?? now
        recording.durationMs = recording.endedAt - recording.startedAt
      }
    }

    const known = new Set(
      this.state.recordings.map((recording) => recording.file).filter((file): file is string => Boolean(file)),
    )
    for (const entry of readdirSync(outputDir)) {
      if (!/\.(flv|mp4|m4a|ts)$/i.test(entry) || known.has(entry)) continue
      const path = join(outputDir, entry)
      const info = statSync(path)
      if (!info.isFile()) continue
      const parsed = parseFileName(entry)
      const twin = parsed ? this.state.recordings.find((recording) => sameCapture(recording, parsed)) : undefined
      if (twin) {
        // A restart mid-capture leaves the recording with no file and the .ts
        // on disk. They are the same capture, so attach instead of adopting.
        if (!twin.file) {
          twin.file = entry
          twin.bytes = info.size
        }
        continue
      }
      this.state.recordings.push({
        id: `disk-${info.ino.toString(36)}-${Math.floor(info.mtimeMs)}`,
        monitorId: null,
        uniqueId: parsed?.uniqueId ?? 'unknown',
        roomId: parsed?.roomId ?? null,
        title: '',
        variant: 'best',
        state: 'completed',
        file: entry,
        startedAt: parsed?.startedAt ?? Math.floor(info.mtimeMs),
        endedAt: Math.floor(info.mtimeMs),
        durationMs: 0,
        bytes: info.size,
        error: null,
      })
    }

    // States written by older builds already hold the duplicate adoptions.
    const duplicates = new Set<Recording>()
    for (const recording of this.state.recordings) {
      if (!recording.id.startsWith('disk-') || !recording.file) continue
      const twin = this.state.recordings.find(
        (other) => other !== recording && !other.id.startsWith('disk-') && sameCapture(other, recording),
      )
      if (!twin) continue
      if (!twin.file) {
        twin.file = recording.file
        twin.bytes = recording.bytes
      }
      duplicates.add(recording)
    }
    if (duplicates.size > 0) this.state.recordings = this.state.recordings.filter((item) => !duplicates.has(item))

    this.state.recordings.sort((a, b) => b.startedAt - a.startedAt)
    if (this.state.recordings.length > 500) this.state.recordings.length = 500
  }
}
