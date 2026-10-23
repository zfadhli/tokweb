import { Elysia } from 'elysia'
import type { ServerDeps } from '../deps'
import { html, renderPage } from '../render'
import type { PageChrome } from '../render'
import type { Monitor, Recording } from '../../core/types'
import {
  displayHandle,
  fmtBytes,
  fmtDate,
  fmtDay,
  fmtDuration,
  initials,
  isPlayable,
  monitorStatus,
  plural,
} from '../view'

export function chrome(deps: ServerDeps, active: PageChrome['active'], title: string): PageChrome {
  return {
    active,
    title,
    live: deps.store.state.monitors.filter((monitor) => monitor.live).length,
    recording: deps.engine.activeCount,
    bun: Bun.version,
  }
}

interface StatCard {
  label: string
  value: string
  note: string
  kind: 'plain' | 'hot'
}

interface DayBar {
  label: string
  bytes: string
  px: number
  hot: boolean
  zero: boolean
}

interface CaptureCard {
  id: string
  handle: string
  initial: string
  title: string
  date: string
  duration: string
  bytes: string
}

interface WatchRow {
  id: string
  handle: string
  status: string
  statusKind: string
}

interface HomeData {
  stats: StatCard[]
  days: DayBar[]
  weekTotal: string
  captures: CaptureCard[]
  watch: WatchRow[]
}

const DAY_MS = 86_400_000

function dayBars(recordings: Recording[]): { days: DayBar[]; total: number } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = today.getTime() - 6 * DAY_MS
  const buckets = Array.from({ length: 7 }, () => 0)
  let total = 0
  for (const recording of recordings) {
    if (!recording.endedAt) continue
    if (recording.startedAt < start) continue
    const index = Math.floor((recording.startedAt - start) / DAY_MS)
    if (index < 0 || index > 6) continue
    buckets[index] = (buckets[index] ?? 0) + (recording.bytes || 0)
    total += recording.bytes || 0
  }
  const peak = Math.max(...buckets)
  const days = buckets.map((bytes, index) => ({
    label: fmtDay(start + index * DAY_MS),
    bytes: fmtBytes(bytes),
    px: bytes === 0 || peak === 0 ? 4 : Math.max(8, Math.round((bytes / peak) * 104)),
    hot: index === 6,
    zero: bytes === 0,
  }))
  return { days, total }
}

function captureCard(recording: Recording): CaptureCard {
  return {
    id: recording.id,
    handle: recording.uniqueId,
    initial: initials(recording.uniqueId),
    title: recording.title || 'Untitled stream',
    date: fmtDate(recording.startedAt),
    duration: fmtDuration(recording.durationMs),
    bytes: fmtBytes(recording.bytes),
  }
}

function watchRows(monitors: Monitor[]): WatchRow[] {
  const rank = (monitor: Monitor): number => {
    if (monitor.state === 'recording') return 0
    return monitor.live ? 1 : 2
  }
  return [...monitors]
    .sort((left, right) => rank(left) - rank(right) || right.updatedAt - left.updatedAt)
    .slice(0, 6)
    .map((monitor) => {
      const status = monitorStatus(monitor)
      return {
        id: monitor.id,
        handle: displayHandle(monitor),
        status: status.label,
        statusKind: status.kind,
      }
    })
}

export function homeData(deps: ServerDeps): HomeData {
  const { monitors, recordings } = deps.store.state
  const completed = recordings.filter(isPlayable)
  const bytes = completed.reduce((sum, recording) => sum + (recording.bytes || 0), 0)
  const duration = completed.reduce((sum, recording) => sum + (recording.durationMs || 0), 0)
  const live = monitors.filter((monitor) => monitor.live).length
  const active = deps.engine.activeCount
  const { days, total } = dayBars(completed)

  return {
    stats: [
      {
        label: 'Recording now',
        value: String(active),
        note: active > 0 ? plural(active, 'ffmpeg process', 'ffmpeg processes') : 'idle',
        kind: active > 0 ? 'hot' : 'plain',
      },
      {
        label: 'On watch',
        value: String(monitors.length),
        note: `${live} live right now`,
        kind: 'plain',
      },
      {
        label: 'Archive',
        value: fmtBytes(bytes),
        note: `${plural(completed.length, 'file')} · ${fmtDuration(duration)}`,
        kind: 'plain',
      },
      {
        label: 'Recorded time',
        value: fmtDuration(duration),
        note: `avg ${fmtDuration(completed.length ? duration / completed.length : 0)} per file`,
        kind: 'plain',
      },
    ],
    days,
    weekTotal: fmtBytes(total),
    captures: completed.slice(0, 6).map(captureCard),
    watch: watchRows(monitors),
  }
}

export function homeRoutes(deps: ServerDeps) {
  return new Elysia({ name: 'home' }).get('/', () =>
    html(renderPage('home', chrome(deps, 'home', 'Overview'), homeData(deps))),
  )
}

