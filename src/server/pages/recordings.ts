import { Elysia } from 'elysia'
import type { ServerDeps } from '../deps'
import { html, renderPage, renderPartial } from '../render'
import type { Recording } from '../../core/types'
import { chrome } from './home'
import { ensureThumb, removeThumb } from '../thumbs'
import { remuxRecording } from '../remux'
import {
  baseName,
  elapsedMs,
  fmtBytes,
  fmtDate,
  fmtDuration,
  initials,
  isActiveRecording,
  isAudioFile,
  isPlayable,
  isRemuxable,
} from '../view'

const DELETE_CONFIRM = 'Delete this recording and its file? This cannot be undone.'
const DELETE_BLOCKED = 'Stop the recording before deleting it.'

type Bucket = 'completed' | 'failed' | 'active'

interface RecordingRow {
  id: string
  handle: string
  title: string
  initial: string
  date: string
  duration: string
  bytes: string
  fileName: string | null
  thumb: boolean
  playable: boolean
  hasFile: boolean
  deletable: boolean
  deleteTitle: string | null
  deleteConfirm: string
  search: string
  bucket: Bucket
  chipClass: string
  chipLabel: string
}

interface RecordingCounts {
  all: number
  completed: number
  failed: number
  active: number
}

function bucketFor(recording: Recording): Bucket {
  if (isActiveRecording(recording)) return 'active'
  // The bucket tracks the remux, not how the capture ended: only a finished
  // MP4/M4A landed in the archive cleanly.
  return isPlayable(recording) ? 'completed' : 'failed'
}

function chipFor(recording: Recording, bucket: Bucket): { chipClass: string; chipLabel: string } {
  if (bucket === 'active') return { chipClass: 'chip is-recording', chipLabel: 'recording' }
  if (bucket === 'completed') return { chipClass: 'chip is-live', chipLabel: 'completed' }
  if (recording.state === 'cancelled') return { chipClass: 'chip is-muted', chipLabel: 'cancelled' }
  return { chipClass: 'chip is-error', chipLabel: recording.state }
}

function rowView(recording: Recording): RecordingRow {
  const bucket = bucketFor(recording)
  const chip = chipFor(recording, bucket)
  const active = bucket === 'active'
  const path = recording.file
  let fileName = 'no file'
  if (active) fileName = 'capturing'
  else if (path) fileName = baseName(path)
  return {
    id: recording.id,
    handle: recording.uniqueId,
    title: recording.title || 'Untitled stream',
    initial: initials(recording.uniqueId),
    date: fmtDate(recording.startedAt),
    duration: fmtDuration(active ? elapsedMs(recording) : recording.durationMs),
    bytes: fmtBytes(recording.bytes),
    fileName,
    thumb: Boolean(path) && !active,
    playable: isPlayable(recording),
    hasFile: Boolean(path),
    deletable: !active,
    deleteTitle: active ? DELETE_BLOCKED : null,
    deleteConfirm: DELETE_CONFIRM,
    search: `${recording.uniqueId} ${recording.title}`.toLowerCase(),
    bucket,
    chipClass: chip.chipClass,
    chipLabel: chip.chipLabel,
  }
}

function tableData(deps: ServerDeps): { rows: RecordingRow[] } {
  return { rows: deps.store.state.recordings.map(rowView) }
}

function countsFor(rows: RecordingRow[]): RecordingCounts {
  const counts: RecordingCounts = { all: rows.length, completed: 0, failed: 0, active: 0 }
  for (const row of rows) counts[row.bucket] += 1
  return counts
}

export function recordingsData(deps: ServerDeps): { stats: unknown[]; counts: RecordingCounts; rows: RecordingRow[] } {
  const { rows } = tableData(deps)
  const completed = rows.filter((row) => row.bucket === 'completed')
  const bytes = deps.store.state.recordings
    .filter((recording) => !isActiveRecording(recording))
    .reduce((sum, recording) => sum + (recording.bytes || 0), 0)
  const duration = deps.store.state.recordings
    .filter((recording) => !isActiveRecording(recording))
    .reduce((sum, recording) => sum + (recording.durationMs || 0), 0)
  return {
    rows,
    counts: countsFor(rows),
    stats: [
      { label: 'Total recordings', value: String(rows.length), note: `${completed.length} completed`, kind: 'plain' },
      { label: 'Stored', value: fmtBytes(bytes), note: 'on this machine', kind: 'plain' },
      { label: 'Captured time', value: fmtDuration(duration), note: 'finished captures', kind: 'plain' },
      {
        label: 'Failed',
        value: String(rows.length - completed.length - rows.filter((row) => row.bucket === 'active').length),
        note: 'needs a look',
        kind: 'plain',
      },
    ],
  }
}

function toastTrigger(message: string, extra: Record<string, unknown> = {}, level = 'ok'): Record<string, string> {
  // HTTP header values must stay Latin-1; handles can carry wider Unicode.
  const safe = message.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
  return { 'HX-Trigger': JSON.stringify({ toast: { message: safe, level }, ...extra }) }
}

export function recordingsRoutes(deps: ServerDeps) {
  return new Elysia({ name: 'recordings' })
    .get('/recordings', () => html(renderPage('recordings', chrome(deps, 'recordings', 'Recordings'), recordingsData(deps))))
    .get('/partials/recordings', () => html(renderPartial('partials/recordings-grid', tableData(deps))))
    .get('/api/recordings/:id/thumb', async ({ params }) => {
      const path = await ensureThumb(deps, params.id)
      if (!path) return new Response(null, { status: 404 })
      return new Response(Bun.file(path), {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
      })
    })
    .get('/recordings/:id', ({ params }) => {
      const recording = deps.store.recording(params.id)
      if (!recording) {
        return html(renderPage('not-found', chrome(deps, 'recordings', 'Not found'), {}), 404)
      }
      const active = isActiveRecording(recording)
      const pageTitle = recording.title || `@${recording.uniqueId}`
      return html(
        renderPage('player', chrome(deps, 'recordings', pageTitle), {
          id: recording.id,
          pageTitle,
          handle: recording.uniqueId,
          hasFile: Boolean(recording.file),
          playable: isPlayable(recording),
          remuxable: isRemuxable(recording),
          audio: isAudioFile(recording),
          isActive: active,
          state: recording.state,
          date: fmtDate(recording.startedAt),
          duration: fmtDuration(active ? elapsedMs(recording) : recording.durationMs),
          bytes: fmtBytes(recording.bytes),
          quality: recording.variant,
          fileName: recording.file ? baseName(recording.file) : 'No file yet',
          error: recording.error ?? 'The capture ended without a playable file.',
          deletable: !active,
          deleteTitle: active ? DELETE_BLOCKED : null,
          deleteConfirm: DELETE_CONFIRM,
        }),
      )
    })
    .delete('/recordings/:id', async ({ params, request }) => {
      const recording = deps.store.recording(params.id)
      if (!recording) return new Response(JSON.stringify({ error: 'Recording not found.' }), { status: 404 })
      if (isActiveRecording(recording)) {
        return new Response(JSON.stringify({ error: DELETE_BLOCKED }), { status: 409 })
      }
      const path = deps.store.recordingPath(recording)
      if (path) await Bun.file(path).delete()
      await removeThumb(deps, params.id)
      deps.store.state.recordings = deps.store.state.recordings.filter((item) => item.id !== params.id)
      deps.store.save()
      let redirect: string | null = null
      try {
        redirect = new URL(request.url).searchParams.get('redirect')
      } catch {
        redirect = null
      }
      if (redirect?.startsWith('/')) return new Response(null, { status: 204, headers: { 'HX-Redirect': redirect } })
      return new Response(null, { status: 204, headers: toastTrigger('Recording deleted.', { refreshRecordings: true }) })
    })
    .post('/recordings/:id/remux', async ({ params }) => {
      const recording = deps.store.recording(params.id)
      if (!recording) return new Response(JSON.stringify({ error: 'Recording not found.' }), { status: 404 })
      if (isActiveRecording(recording)) {
        return new Response(JSON.stringify({ error: 'Stop the recording before converting it.' }), { status: 409 })
      }
      if (!isRemuxable(recording)) {
        return new Response(JSON.stringify({ error: 'Only .ts captures need remuxing.' }), { status: 409 })
      }
      const result = await remuxRecording(deps, recording)
      if (result.ok) {
        deps.store.save()
        return new Response(null, { status: 204, headers: { 'HX-Redirect': `/recordings/${params.id}` } })
      }
      return new Response(null, { status: 204, headers: toastTrigger(result.error ?? 'Conversion failed.', {}, 'error') })
    })
}
