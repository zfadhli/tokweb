import { Elysia } from 'elysia'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { Engine, EngineError } from './engine'
import type { Variant } from './core/types'
import { VARIANTS } from './core/types'
import type { Store } from './store'
import { TikTokClient, TikTokError, selectSource } from './tiktok/client'

const PUBLIC_DIR = resolve(import.meta.dir, '..', 'public')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export interface ServerDeps {
  store: Store
  engine: Engine
  client: TikTokClient
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function publicSettings(store: Store): Record<string, unknown> {
  const { cookies, ...rest } = store.state.settings
  return { ...rest, hasCookies: cookies.trim().length > 0 }
}

function snapshot(deps: ServerDeps): Record<string, unknown> {
  const { store, engine } = deps
  return {
    monitors: store.state.monitors,
    recordings: store.state.recordings.map((recording) => ({
      ...recording,
      fileUrl: recording.file ? `/api/recordings/${recording.id}/file` : null,
      downloadUrl: recording.file ? `/api/recordings/${recording.id}/download` : null,
    })),
    settings: publicSettings(store),
    system: {
      activeRecordings: engine.activeCount,
      outputDir: store.state.settings.outputDir,
      ffmpegPath: store.state.settings.ffmpegPath,
      bun: Bun.version,
    },
  }
}

function monitorInput(body: unknown): Parameters<Engine['addMonitor']>[0] {
  const input = isRecord(body) ? body : {}
  const string = (key: string): string | undefined => {
    const value = input[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  const result: Parameters<Engine['addMonitor']>[0] = {
    uniqueId: string('uniqueId'),
    url: string('url'),
    roomId: string('roomId'),
  }
  const variant = string('variant')
  if (variant && (VARIANTS as readonly string[]).includes(variant)) result.variant = variant as Variant
  if (typeof input.autoRecord === 'boolean') result.autoRecord = input.autoRecord
  if (typeof input.intervalSec === 'number') result.intervalSec = input.intervalSec
  if (input.maxDurationSec === null) result.maxDurationSec = null
  if (typeof input.maxDurationSec === 'number') result.maxDurationSec = input.maxDurationSec
  return result
}

function monitorPatch(body: unknown): Parameters<Engine['updateMonitor']>[1] {
  const input = isRecord(body) ? body : {}
  const patch: Parameters<Engine['updateMonitor']>[1] = {}
  if (typeof input.autoRecord === 'boolean') patch.autoRecord = input.autoRecord
  if (typeof input.intervalSec === 'number') patch.intervalSec = input.intervalSec
  if (input.maxDurationSec === null) patch.maxDurationSec = null
  if (typeof input.maxDurationSec === 'number') patch.maxDurationSec = input.maxDurationSec
  if (typeof input.variant === 'string' && (VARIANTS as readonly string[]).includes(input.variant)) {
    patch.variant = input.variant as Variant
  }
  return patch
}

async function updateSettings(deps: ServerDeps, body: unknown): Promise<void> {
  const input = isRecord(body) ? body : {}
  const settings = deps.store.state.settings
  if (typeof input.outputDir === 'string' && input.outputDir.trim()) {
    const nextDir = resolve(process.cwd(), input.outputDir.trim())
    if (nextDir !== settings.outputDir) {
      const previousDir = settings.outputDir
      for (const recording of deps.store.state.recordings) {
        if (!recording.file || isAbsolute(recording.file)) continue
        const previousPath = join(previousDir, recording.file)
        if (await Bun.file(previousPath).exists()) recording.file = previousPath
      }
      settings.outputDir = nextDir
    }
  }
  if (typeof input.ffmpegPath === 'string' && input.ffmpegPath.trim()) settings.ffmpegPath = input.ffmpegPath.trim()
  if (typeof input.proxy === 'string') settings.proxy = input.proxy.trim()
  if (typeof input.userAgent === 'string') settings.userAgent = input.userAgent.trim()
  if (typeof input.cookies === 'string') {
    settings.cookies = input.cookies
    deps.client.setCookies(input.cookies)
  }
  deps.client.setNetwork({ proxy: settings.proxy, userAgent: settings.userAgent })
  if (typeof input.keepSource === 'boolean') settings.keepSource = input.keepSource
  if (typeof input.bitrate === 'string') {
    const value = input.bitrate.trim()
    settings.bitrate = /^(\d+(\.\d+)?[kKmM]?)?$/.test(value) ? value : settings.bitrate
  }
  if (typeof input.defaultVariant === 'string' && (VARIANTS as readonly string[]).includes(input.defaultVariant)) {
    settings.defaultVariant = input.defaultVariant as Variant
  }
  if (typeof input.defaultIntervalSec === 'number') {
    settings.defaultIntervalSec = Math.min(86_400, Math.max(10, Math.round(input.defaultIntervalSec)))
  }
  if (typeof input.defaultMaxDurationSec === 'number') {
    settings.defaultMaxDurationSec = Math.min(86_400, Math.max(0, Math.round(input.defaultMaxDurationSec)))
  }
  deps.store.save()
}

function mediaResponse(path: string, request: Request, download = false): Response {
  const file = Bun.file(path)
  const size = file.size
  const extension = path.slice(path.lastIndexOf('.'))
  const headers = new Headers({
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })
  if (download) headers.set('Content-Disposition', `attachment; filename="${basename(path).replace(/"/g, '')}"`)

  const range = request.headers.get('range')
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/)
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
        headers.set('Content-Length', String(end - start + 1))
        return new Response(file.slice(start, end + 1), { status: 206, headers })
      }
    }
  }
  headers.set('Content-Length', String(size))
  return new Response(file, { headers })
}

function sseResponse(deps: ServerDeps, request: Request): Response {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | null = null
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot(deps))}\n\n`))
        } catch {
          closed = true
          if (timer) clearInterval(timer)
        }
      }
      send()
      timer = setInterval(send, 2_000)
      request.signal.addEventListener('abort', () => {
        closed = true
        if (timer) clearInterval(timer)
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      })
    },
    cancel() {
      closed = true
      if (timer) clearInterval(timer)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export function createApp(deps: ServerDeps) {
  return (
    new Elysia({ name: 'tokweb' })
      .onError(({ error, set }) => {
        if (error instanceof EngineError) {
          set.status = error.status
          return { error: error.message }
        }
        if (error instanceof TikTokError) {
          set.status = error.kind === 'not-found' ? 400 : 502
          return { error: error.message }
        }
        const message = error instanceof Error ? error.message : String(error)
        set.status = 500
        return { error: message }
      })
      .get('/api/health', () => ({ ok: true, bun: Bun.version }))
      .get('/api/state', () => snapshot(deps))
      .get('/api/events', ({ request }) => sseResponse(deps, request))
      .get('/api/settings', () => publicSettings(deps.store))
      .put('/api/settings', async ({ body }) => {
        await updateSettings(deps, body)
        return publicSettings(deps.store)
      })
      .post('/api/probe', async ({ body }) => {
        const input = isRecord(body) ? body : {}
        const room = await deps.client.resolve({
          uniqueId: typeof input.uniqueId === 'string' ? input.uniqueId : undefined,
          roomId: typeof input.roomId === 'string' ? input.roomId : undefined,
          url: typeof input.url === 'string' ? input.url : undefined,
        })
        const variant =
          typeof input.variant === 'string' && (VARIANTS as readonly string[]).includes(input.variant)
            ? (input.variant as Variant)
            : deps.store.state.settings.defaultVariant
        return { room, source: room.status === 'live' ? selectSource(room, variant) : null }
      })
      .get('/api/monitors', () => deps.store.state.monitors)
      .post('/api/monitors', async ({ body, set }) => {
        const monitor = await deps.engine.addMonitor(monitorInput(body))
        set.status = 201
        return monitor
      })
      .patch('/api/monitors/:id', ({ params, body }) => deps.engine.updateMonitor(params.id, monitorPatch(body)))
      .delete('/api/monitors/:id', async ({ params, set }) => {
        const removed = await deps.engine.removeMonitor(params.id)
        if (!removed) {
          set.status = 404
          return { error: 'Monitor not found.' }
        }
        return { ok: true }
      })
      .post('/api/monitors/:id/check', async ({ params }) => deps.engine.check(params.id))
      .post('/api/monitors/:id/record', async ({ params }) => deps.engine.recordNow(params.id))
      .post('/api/monitors/:id/stop', async ({ params }) => {
        const recording = await deps.engine.stopRecording(params.id)
        return { recording }
      })
      .get('/api/recordings', () => snapshot(deps).recordings)
      .get('/api/recordings/:id/file', ({ params, request }) => {
        const recording = deps.store.recording(params.id)
        if (!recording) return new Response(JSON.stringify({ error: 'Recording not found.' }), { status: 404 })
        const path = deps.store.recordingPath(recording)
        if (!path) return new Response(JSON.stringify({ error: 'File is missing.' }), { status: 404 })
        return mediaResponse(path, request)
      })
      .get('/api/recordings/:id/download', ({ params, request }) => {
        const recording = deps.store.recording(params.id)
        if (!recording) return new Response(JSON.stringify({ error: 'Recording not found.' }), { status: 404 })
        const path = deps.store.recordingPath(recording)
        if (!path) return new Response(JSON.stringify({ error: 'File is missing.' }), { status: 404 })
        return mediaResponse(path, request, true)
      })
      .delete('/api/recordings/:id', async ({ params, set }) => {
        const recording = deps.store.recording(params.id)
        if (!recording) {
          set.status = 404
          return { error: 'Recording not found.' }
        }
        if (recording.state === 'recording' || recording.state === 'starting' || recording.state === 'finalizing') {
          set.status = 409
          return { error: 'Stop the recording before deleting it.' }
        }
        const path = deps.store.recordingPath(recording)
        if (path) await Bun.file(path).delete()
        deps.store.state.recordings = deps.store.state.recordings.filter((item) => item.id !== params.id)
        deps.store.save()
        return { ok: true }
      })
      .get('/', () => new Response(Bun.file(join(PUBLIC_DIR, 'index.html'))))
      .get('/assets/*', async ({ params }) => {
        const name = params['*'] ?? ''
        const path = resolve(PUBLIC_DIR, name)
        if (!path.startsWith(`${PUBLIC_DIR}${sep}`) || !(await Bun.file(path).exists())) {
          return new Response('Not found', { status: 404 })
        }
        const extension = path.slice(path.lastIndexOf('.'))
        return new Response(Bun.file(path), {
          headers: { 'Content-Type': MIME[extension] ?? 'application/octet-stream' },
        })
      })
      .get('/favicon.ico', () => new Response('', { status: 204 }))
  )
}
