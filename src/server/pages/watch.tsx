import { Elysia } from 'elysia'
import { html } from '@elysia/html'
import { EngineError } from '../../engine'
import type { ServerDeps } from '../deps'
import type { PageChrome } from '../views/layout'
import type { Monitor, Variant } from '../../core/types'
import { chrome } from './home'
import { displayHandle, initials, monitorStatus } from '../view'
import { Watch, type Bucket, type WatchRow, type WatchView } from '../views/watch'
import { Users } from '../views/partials/users'

export function parseTarget(raw: unknown): { uniqueId?: string; url?: string; roomId?: string } | null {
  const target = typeof raw === 'string' ? raw.trim() : ''
  if (!target) return null
  if (/^https?:\/\//i.test(target) || /tiktok\.com\//i.test(target)) return { url: target }
  if (/^\d+$/.test(target) && target.length >= 6) return { roomId: target }
  const uniqueId = target.replace(/^@+/, '')
  return uniqueId ? { uniqueId } : null
}

function bucketFor(monitor: Monitor): Bucket {
  if (monitor.state === 'recording' || monitor.recordingId) return 'recording'
  if (monitor.live) return 'live'
  return 'offline'
}

function rowView(monitor: Monitor): WatchRow {
  const status = monitorStatus(monitor)
  const handle = displayHandle(monitor)
  const live = status.kind === 'live' || status.kind === 'recording'
  const bucket = bucketFor(monitor)
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
    confirm: `Remove @${handle} and stop any active recording?`,
  }
}

export function watchPanel(deps: ServerDeps, notice: string | null = null): WatchView {
  const rows = deps.store.state.monitors.map(rowView)
  const offline = rows.filter((row) => row.bucket === 'offline')
  const live = rows.filter((row) => row.bucket === 'live')
  const recording = rows.filter((row) => row.bucket === 'recording')
  return {
    notice,
    total: rows.length,
    columns: [
      { key: 'offline', label: 'Offline', count: offline.length, rows: offline },
      { key: 'live', label: 'Live', count: live.length, rows: live },
      { key: 'recording', label: 'Recording', count: recording.length, rows: recording },
    ],
  }
}

function pageChrome(deps: ServerDeps): PageChrome {
  return chrome(deps, 'watch', 'Watch')
}

function panelShell(deps: ServerDeps, notice: string | null = null) {
  return (
    <div class="panel" id="users-panel" hx-get="/partials/users" hx-trigger="refreshUsers from:body, every 3s" hx-swap="innerMorph" hx-target="this">
      <Users {...watchPanel(deps, notice)} />
    </div>
  )
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
    .use(html())
    .get('/watch', ({ html }) => html(<Watch chrome={pageChrome(deps)} data={watchPanel(deps)} />))
    .get('/partials/users', ({ html }) => html(<Users {...watchPanel(deps)} />))
    .post('/watch', async ({ body, html }) => {
      const input = (body ?? {}) as Record<string, unknown>
      const parsed = parseTarget(input.target)
      if (!parsed?.uniqueId && !parsed?.url && !parsed?.roomId) {
        return html(await panelShell(deps, 'Enter a username, live URL, or room id.'))
      }
      try {
        const monitor = await deps.engine.addMonitor(parsed)
        return new Response(await panelShell(deps), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...toastTrigger(`Added @${displayHandle(monitor)} to watch.`) },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not add that target.'
        return html(await panelShell(deps, message))
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
