import { Elysia } from 'elysia'
import { html } from '@elysia/html'
import type { ServerDeps } from '../deps'
import type { PageChrome } from '../views/layout'
import { Home, type CaptureCard, type CreatorCard, type DayBar, type HomeView, type StatCard } from '../views/home'
import type { Monitor, Recording } from '../../core/types'
import { fmtBytes, fmtDay, fmtDayMonth, fmtDuration, initials, isPlayable, plural } from '../view'

export function chrome(deps: ServerDeps, active: PageChrome['active'], title: string): PageChrome {
  return {
    active,
    title,
    live: deps.store.state.monitors.filter((monitor) => monitor.live).length,
    recording: deps.engine.activeCount,
    bun: Bun.version,
  }
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
    pct: bytes === 0 || peak === 0 ? 0 : Math.max(6, Math.round((bytes / peak) * 100)),
    rest: bytes === 0 || peak === 0 ? 100 : 100 - Math.max(6, Math.round((bytes / peak) * 100)),
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
    date: fmtDayMonth(recording.startedAt),
    duration: fmtDuration(recording.durationMs),
    bytes: fmtBytes(recording.bytes),
    thumb: Boolean(recording.file),
  }
}

function topCreators(recordings: Recording[], monitors: Monitor[]): CreatorCard[] {
  const avatars = new Map<string, string>()
  for (const monitor of monitors) {
    if (monitor.uniqueId && monitor.avatarUrl && !avatars.has(monitor.uniqueId)) {
      avatars.set(monitor.uniqueId, monitor.avatarUrl)
    }
  }
  const byHandle = new Map<string, { files: number; bytes: number }>()
  for (const recording of recordings) {
    if (!recording.file) continue
    const tally = byHandle.get(recording.uniqueId) ?? { files: 0, bytes: 0 }
    tally.files += 1
    tally.bytes += recording.bytes || 0
    byHandle.set(recording.uniqueId, tally)
  }
  return [...byHandle]
    .sort(
      ([leftHandle, left], [rightHandle, right]) =>
        right.files - left.files ||
        right.bytes - left.bytes ||
        leftHandle.localeCompare(rightHandle),
    )
    .slice(0, 4)
    .map(([handle, tally]) => ({
      handle,
      initial: initials(handle),
      avatarUrl: avatars.get(handle) ?? null,
      files: plural(tally.files, 'file'),
      bytes: fmtBytes(tally.bytes),
    }))
}

export function homeData(deps: ServerDeps): HomeView {
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
    captures: completed.slice(0, 4).map(captureCard),
    creators: topCreators(recordings, monitors),
  }
}

export function homeRoutes(deps: ServerDeps) {
  return new Elysia({ name: 'home' }).use(html()).get('/', ({ html }) =>
    html(<Home chrome={chrome(deps, 'home', 'Overview')} data={homeData(deps)} />),
  )
}

