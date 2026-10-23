import type { Monitor, Recording } from '../core/types'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape a value for HTML text or an attribute value.
 *
 * @kitajs/html does not escape interpolations, so every view component must pass
 * untrusted text (handles, titles, file names, errors) through this function.
 */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const power = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${BYTE_UNITS[power]}`
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

export function fmtDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function fmtDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-GB', { weekday: 'short' })
}

/** Date without the clock, for cards too narrow for a full timestamp. */
export function fmtDayMonth(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function initials(name: string | null): string {
  const clean = String(name ?? '').replace(/[^a-z0-9]/gi, '')
  return (clean.slice(0, 2) || '?').toUpperCase()
}

export type StatusKind = 'live' | 'recording' | 'error' | 'checking' | 'standby' | 'idle' | 'stopped'

export interface StatusView {
  label: string
  kind: StatusKind
}

export function monitorStatus(monitor: Monitor): StatusView {
  if (monitor.state === 'recording') return { label: 'recording', kind: 'recording' }
  if (monitor.state === 'error') return { label: 'error', kind: 'error' }
  if (monitor.state === 'checking') return { label: 'checking', kind: 'checking' }
  if (monitor.live) return { label: 'live', kind: 'live' }
  if (monitor.state === 'stopped') return { label: 'stopped', kind: 'stopped' }
  if (monitor.state === 'waiting') return { label: 'idle', kind: 'idle' }
  return { label: 'standby', kind: 'standby' }
}

export const ACTIVE_STATES = ['starting', 'recording', 'finalizing'] as const

export function isActiveRecording(recording: Recording): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(recording.state)
}

const PLAYABLE_EXTENSIONS = ['.mp4', '.m4a', '.webm']

export function isPlayable(recording: Recording): boolean {
  // State records how the capture ended, not whether the file is usable.
  if (!recording.file) return false
  const extension = recording.file.slice(recording.file.lastIndexOf('.')).toLowerCase()
  return PLAYABLE_EXTENSIONS.includes(extension)
}

export function isRemuxable(recording: Recording): boolean {
  return recording.file?.toLowerCase().endsWith('.ts') ?? false
}

export function isAudioFile(recording: Recording): boolean {
  return recording.file?.toLowerCase().endsWith('.m4a') ?? false
}

export function elapsedMs(recording: Recording, now = Date.now()): number {
  if (recording.endedAt) return recording.durationMs
  return Math.max(recording.durationMs, now - recording.startedAt)
}

export function baseName(path: string | null): string {
  return String(path ?? '').split(/[\\/]/).pop() || 'recording.mp4'
}

export function displayHandle(monitor: Pick<Monitor, 'uniqueId' | 'roomId'>): string {
  return monitor.uniqueId ?? monitor.roomId ?? 'unknown'
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
