import { Elysia } from 'elysia'
import { EngineError } from '../../engine'
import type { ServerDeps } from '../deps'
import { html, renderPage, renderPartial } from '../render'
import type { PageChrome } from '../render'
import type { Monitor, Variant } from '../../core/types'
import { VARIANTS } from '../../core/types'
import { chrome } from './home'
import { displayHandle, initials, monitorStatus } from '../view'

const PANEL_ATTRS =
  'id="users-panel" hx-get="/partials/users" hx-trigger="refreshUsers from:body, every 3s" hx-swap="innerMorph" hx-target="this"'

export function parseTarget(raw: unknown): { uniqueId?: string; url?: string; roomId?: string } | null {
  const target = typeof raw === 'string' ? raw.trim() : ''
  if (!target) return null
  if (/^https?:\/\//i.test(target) || /tiktok\.com\//i.test(target)) return { url: target }
  if (/^\d+$/.test(target) && target.length >= 6) return { roomId: target }
  const uniqueId = target.replace(/^@+/, '')
  return uniqueId ? { uniqueId } : null
}

type Bucket = 'live' | 'recording' | 'offline'

interface VariantOption {
  value: string
  label: string
  selected: boolean
}

interface WatchRow {
  id: string
  handle: string
  title: string
  initial: string
  avatarUrl: string | null
  status: string
  chipClass: string
  dot: boolean
  dotClass: string
  bucket: Bucket
  isRecording: boolean
  autoRecord: boolean
  intervalMin: number
  variant: Variant
  variants: VariantOption[]
  confirm: string
}

interface WatchPanel {
  notice: string | null
  rows: WatchRow[]
  counts: Record<'all' | Bucket, number>
}

function bucketFor(monitor: Monitor): Bucket {
  if (monitor.state === 'recording' || monitor.recordingId) return 'recording'
  return monitor.live ? 'live' : 'offline'
}

function rowView(monitor: Monitor): WatchRow {
  const status = monitorStatus(monitor)
  const bucket = bucketFor(monitor)
  const handle = displayHandle(monitor)
  const live = status.kind === 'live' || status.kind === 'recording'
  return {
    id: monitor.id,
    handle,
    title: monitor.title || 'No title yet',
    initial: initials(monitor.uniqueId ?? monitor.roomId),
    avatarUrl: monitor.avatarUrl,
    status: status.label,
    chipClass: status.kind === 'live' || status.kind === 'recording' || status.kind === 'error' || status.kind === 'checking'
      ? `chip is-${status.kind}`
      : 'chip is-muted',
    dot: live,
    dotClass: status.kind === 'recording' ? 'is-recording' : 'is-live',
    bucket,
    isRecording: bucket === 'recording',
    autoRecord: monitor.autoRecord,
    intervalMin: Math.max(1, Math.round(monitor.intervalSec / 60)),
    variant: monitor.variant,
    variants: VARIANTS.map((value) => ({ value, label: value, selected: value === monitor.variant })),
    confirm: `Remove @${handle} and stop any active recording?`,
  }
}

export function watchPanel(deps: ServerDeps, notice: string | null = null): WatchPanel {
  const rows = deps.store.state.monitors.map(rowView)
  const counts: WatchPanel['counts'] = { all: rows.length, live: 0, recording: 0, offline: 0 }
  for (const row of rows) counts[row.bucket] += 1
  return { notice, rows, counts }
}

function pageChrome(deps: ServerDeps): PageChrome {
  return chrome(deps, 'watch', 'Watch')
}

function panelShell(deps: ServerDeps, notice: string | null = null): string {
  return `<div ${PANEL_ATTRS}>${renderPartial('partials/users', watchPanel(deps, notice))}</div>`
}

function toastTrigger(message: string, level = 'ok'): Record<string, string> {
  // HTTP header values must stay Latin-1; handles can carry wider Unicode.
  const safe = message.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
  return { 'HX-Trigger': JSON.stringify({ toast: { message: safe, level }, refreshUsers: true }) }
}

function refreshOnly(message: string, level = 'ok'): Response {
  return new Response(null, { status: 204, headers: toastTrigger(message, level) })
}

function actionError(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Request failed.'
  const status = error instanceof EngineError ? error.status : 502
  if (status === 404) return new Response(JSON.stringify({ error: message }), { status })
  return refreshOnly(message, 'error')
}

function parseAutoRecord(value: unknown): boolean {
  return value === 'on' || value === 'true' || value === '1' || value === true
}

export function watchRoutes(deps: ServerDeps) {
  return new Elysia({ name: 'watch' })
    .get('/watch', () => html(renderPage('watch', pageChrome(deps), watchPanel(deps))))
    .get('/partials/users', () => html(renderPartial('partials/users', watchPanel(deps))))
    .post('/watch', async ({ body }) => {
      const input = (body ?? {}) as Record<string, unknown>
      const parsed = parseTarget(input.target)
      if (!parsed?.uniqueId && !parsed?.url && !parsed?.roomId) {
        return html(panelShell(deps, 'Enter a username, live URL, or room id.'), 200)
      }
      try {
        const monitor = await deps.engine.addMonitor(parsed)
        return new Response(panelShell(deps), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...toastTrigger(`Added @${displayHandle(monitor)} to watch.`) },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not add that target.'
        return html(panelShell(deps, message), 200)
      }
    })
    .post('/watch/:id/check', async ({ params }) => {
      try {
        const monitor = await deps.engine.check(params.id)
        const handle = displayHandle(monitor)
        return refreshOnly(monitor.live ? `Checked @${handle} - live now.` : `Checked @${handle} - offline.`)
      } catch (error) {
        return actionError(error)
      }
    })
    .post('/watch/:id/record', async ({ params }) => {
      try {
        await deps.engine.recordNow(params.id)
        const monitor = deps.store.monitor(params.id)
        return refreshOnly(`Recording started for @${monitor ? displayHandle(monitor) : 'user'}.`)
      } catch (error) {
        return actionError(error)
      }
    })
    .post('/watch/:id/stop', async ({ params }) => {
      try {
        await deps.engine.stopRecording(params.id)
        const monitor = deps.store.monitor(params.id)
        return refreshOnly(`Recording stopped${monitor ? ` for @${displayHandle(monitor)}` : ''}.`)
      } catch (error) {
        return actionError(error)
      }
    })
    .patch('/watch/:id', ({ params, body }) => {
      try {
        const input = (body ?? {}) as Record<string, unknown>
        if (typeof input.variant === 'string') {
          const monitor = deps.engine.updateMonitor(params.id, { variant: input.variant as Variant })
          return refreshOnly(`Quality set to ${monitor.variant} for @${displayHandle(monitor)}.`)
        }
        const monitor = deps.engine.updateMonitor(params.id, { autoRecord: parseAutoRecord(input.autoRecord) })
        return refreshOnly(`Auto-record ${monitor.autoRecord ? 'on' : 'off'} for @${displayHandle(monitor)}.`)
      } catch (error) {
        return actionError(error)
      }
    })
    .delete('/watch/:id', async ({ params }) => {
      const monitor = deps.store.monitor(params.id)
      if (!monitor) return new Response(JSON.stringify({ error: 'Monitor not found.' }), { status: 404 })
      const handle = displayHandle(monitor)
      try {
        await deps.engine.removeMonitor(params.id)
        return refreshOnly(`Removed @${handle}.`)
      } catch (error) {
        return actionError(error)
      }
    })
}
