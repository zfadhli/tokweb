import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Engine } from '../src/engine'
import { createApp } from '../src/server'
import { recordingsRoutes } from '../src/server/pages/recordings'
import { Store } from '../src/store'
import { TikTokClient } from '../src/tiktok/client'
import type { Recording } from '../src/core/types'
import { FakeResolver, fakeRecorderFactory, liveRoom, tempDir } from './helpers'

function setup() {
  const dir = tempDir()
  const store = new Store({ dataDir: join(dir, 'data'), outputDir: join(dir, 'out') }).load()
  mkdirSync(store.state.settings.outputDir, { recursive: true })
  const recorder = fakeRecorderFactory()
  const engine = new Engine(store, new FakeResolver(liveRoom()), { recorder: recorder.factory })
  const deps = { store, engine, client: new TikTokClient() }
  const app = createApp(deps).use(recordingsRoutes(deps))
  return { dir, store, engine, app }
}

function addRecording(store: Store, overrides: Partial<Recording> = {}): Recording {
  const file = overrides.file === undefined ? `${overrides.id ?? 'rec-1'}.mp4` : overrides.file
  if (file) writeFileSync(join(store.state.settings.outputDir, file), 'video-bytes')
  const recording: Recording = {
    id: 'rec-1',
    monitorId: null,
    uniqueId: 'aurorabeats',
    roomId: null,
    title: 'Night session',
    variant: 'hd',
    state: 'completed',
    file,
    startedAt: new Date(2026, 6, 7, 14, 5).getTime(),
    endedAt: new Date(2026, 6, 7, 14, 8).getTime(),
    durationMs: 180_000,
    bytes: 11,
    error: null,
    ...overrides,
  }
  store.state.recordings.push(recording)
  return recording
}

const get = (app: ReturnType<typeof setup>['app'], path: string): Promise<Response> =>
  app.handle(new Request(`http://localhost${path}`))

function trigger(response: Response): Record<string, unknown> {
  return JSON.parse(response.headers.get('HX-Trigger') ?? '{}') as Record<string, unknown>
}

describe('recordings page', () => {
  test('GET /recordings renders head, summary, toolbar, polling panel, and empty state', async () => {
    const { app } = setup()
    const response = await get(app, '/recordings')
    expect(response.status).toBe(200)
    const page = await response.text()
    for (const marker of [
      '<p class="eyebrow">Archive</p>',
      '<h1>Recordings</h1>',
      'x-data="{ q: \'\', state: \'all\' }"',
      'placeholder="Search handle or title"',
      'hx-get="/partials/recordings"',
      'refreshRecordings from:body, every 5s',
      'hx-target="this"',
      'hx-swap="innerMorph"',
      'id="recordings-panel"',
      'All (0)',
      'Completed (0)',
      'Failed (0)',
      'In progress (0)',
      'No recordings yet.',
      'Captures land here once a watch user goes live with auto-record on.',
    ]) {
      expect(page).toContain(marker)
    }
  })

  test('rows expose columns, chips, search buckets, and actions', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-done', uniqueId: 'aurorabeats', title: 'Night session' })
    addRecording(store, {
      id: 'rec-live',
      uniqueId: 'pixelgarden',
      title: 'Greenhouse build',
      state: 'recording',
      file: null,
      endedAt: null,
      durationMs: 60_000,
      bytes: 0,
    })
    addRecording(store, {
      id: 'rec-bad',
      uniqueId: 'northlight',
      title: 'Late radio set',
      state: 'failed',
      file: null,
      error: 'ffmpeg exited with code 1',
    })
    const page = await (await get(app, '/recordings')).text()
    for (const marker of [
      'data-search="aurorabeats night session"',
      'data-state="completed"',
      'data-state="active"',
      'data-state="failed"',
      "$el.dataset.search.includes(q.toLowerCase())",
      'chip is-live',
      'chip is-recording',
      'chip is-error',
      'href="/recordings/rec-done"',
      'href="/api/recordings/rec-done/download"',
      'src="/api/recordings/rec-done/thumb"',
      'class="capture-thumb"',
      'hx-delete="/recordings/rec-done"',
      'hx-confirm="Delete this recording and its file? This cannot be undone."',
      'hx-swap="none"',
      'hx-delete="/recordings/rec-live"',
      'disabled',
      'Stop the recording before deleting it.',
      'All (3)',
      'Completed (1)',
      'Failed (1)',
      'In progress (1)',
    ]) {
      expect(page).toContain(marker)
    }
    expect(page).not.toContain('href="/api/recordings/rec-live/download"')
  })

  test('GET /partials/recordings returns only the card grid fragment', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-1', uniqueId: 'aurorabeats', title: 'Night session' })
    const response = await get(app, '/partials/recordings')
    expect(response.status).toBe(200)
    const fragment = await response.text()
    expect(fragment).not.toContain('<!doctype html>')
    expect(fragment).not.toContain('x-data')
    expect(fragment).toContain('class="capture-grid is-recordings"')
    expect(fragment).toContain('@aurorabeats')
    expect(fragment).not.toContain('<table')
  })

  test('thumbnails render once for finished files and 404 otherwise', async () => {
    const { app, store, dir } = setup()
    const fake = join(dir, 'fake-ffmpeg.sh')
    writeFileSync(fake, '#!/bin/sh\nfor last; do :; done\nprintf JPG > "$last"\n', { mode: 0o755 })
    store.state.settings.ffmpegPath = fake
    addRecording(store, { id: 'rec-thumb', uniqueId: 'aurorabeats' })
    addRecording(store, { id: 'rec-busy', uniqueId: 'pixelgarden', state: 'recording', file: null, endedAt: null })

    const thumb = await get(app, '/api/recordings/rec-thumb/thumb')
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get('Content-Type')).toBe('image/jpeg')
    expect(await thumb.text()).toBe('JPG')

    expect((await get(app, '/api/recordings/rec-busy/thumb')).status).toBe(404)
    expect((await get(app, '/api/recordings/missing/thumb')).status).toBe(404)

    const cached = join(store.dataDir, 'thumbs', 'rec-thumb.jpg')
    expect(await Bun.file(cached).exists()).toBe(true)
    await app.handle(new Request('http://localhost/recordings/rec-thumb', { method: 'DELETE' }))
    expect(await Bun.file(cached).exists()).toBe(false)
  })

  test('DELETE removes the file and row with a toast and refresh trigger', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-gone', uniqueId: 'aurorabeats' })
    const response = await app.handle(new Request('http://localhost/recordings/rec-gone', { method: 'DELETE' }))
    expect(response.status).toBe(204)
    const sent = trigger(response)
    expect(sent.refreshRecordings).toBe(true)
    expect(JSON.stringify(sent.toast)).toContain('Recording deleted.')
    expect(store.state.recordings).toHaveLength(0)
  })

  test('DELETE refuses active recordings and unknown ids as JSON', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-busy', state: 'recording', file: null, endedAt: null })
    const busy = await app.handle(new Request('http://localhost/recordings/rec-busy', { method: 'DELETE' }))
    expect(busy.status).toBe(409)
    expect(await busy.json()).toEqual({ error: 'Stop the recording before deleting it.' })
    expect(store.state.recordings).toHaveLength(1)
    const missing = await app.handle(new Request('http://localhost/recordings/nope', { method: 'DELETE' }))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Recording not found.' })
  })

  test('DELETE with redirect answers HX-Redirect for the player page', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-1', uniqueId: 'aurorabeats' })
    const response = await app.handle(
      new Request('http://localhost/recordings/rec-1?redirect=/recordings', { method: 'DELETE' }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('HX-Redirect')).toBe('/recordings')
    expect(store.state.recordings).toHaveLength(0)
  })

  test('player renders video, meta grid, and head actions', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-1', uniqueId: 'aurorabeats', title: 'Night session' })
    const response = await get(app, '/recordings/rec-1')
    expect(response.status).toBe(200)
    const page = await response.text()
    for (const marker of [
      '<h1>Night session</h1>',
      '<video class="player-video" controls preload="metadata" src="/api/recordings/rec-1/file">',
      'meta-grid',
      'href="/recordings"',
      'Back to recordings',
      'href="/api/recordings/rec-1/download"',
      'hx-delete="/recordings/rec-1?redirect=/recordings"',
    ]) {
      expect(page).toContain(marker)
    }
  })

  test('player renders audio element for m4a recordings and video for mp4', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-audio', uniqueId: 'aurorabeats', file: 'rec-audio.m4a', variant: 'audio' })
    addRecording(store, { id: 'rec-video', uniqueId: 'aurorabeats' })
    const audioPage = await (await get(app, '/recordings/rec-audio')).text()
    expect(audioPage).toContain('<audio class="player-audio" controls preload="metadata" src="/api/recordings/rec-audio/file">')
    expect(audioPage).not.toContain('<video')
    const videoPage = await (await get(app, '/recordings/rec-video')).text()
    expect(videoPage).toContain('<video class="player-video"')
  })

  test('player falls back to @handle and explains missing files', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-bad', uniqueId: 'northlight', title: '', state: 'failed', file: null, error: 'ffmpeg exited with code 1' })
    const page = await (await get(app, '/recordings/rec-bad')).text()
    expect(page).toContain('<h1>@northlight</h1>')
    expect(page).not.toContain('<video')
    expect(page).toContain('ffmpeg exited with code 1')
  })

  test('a stopped capture keeps its play button, a TS-only file does not', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-stop', uniqueId: 'aurorabeats', state: 'cancelled' })
    addRecording(store, { id: 'rec-ts', uniqueId: 'northlight', state: 'failed', file: 'northlight.ts' })
    const page = await (await get(app, '/recordings')).text()
    const rowFor = (id: string): string =>
      page.split('<article class="capture is-card"').filter((row) => row.includes(`hx-delete="/recordings/${id}"`)).join('')
    expect(rowFor('rec-stop')).toContain('href="/recordings/rec-stop"')
    expect(rowFor('rec-stop')).toContain('capture-play')
    expect(rowFor('rec-ts')).not.toContain('capture-play')
    expect(page).toContain('href="/api/recordings/rec-ts/download"')
    expect(page).toContain('Completed (1)')
    expect(page).toContain('Failed (1)')
    expect(rowFor('rec-stop')).toContain('data-state="completed"')
    expect(rowFor('rec-ts')).toContain('data-state="failed"')

    const stopped = await (await get(app, '/recordings/rec-stop')).text()
    expect(stopped).toContain('<video class="player-video" controls preload="metadata" src="/api/recordings/rec-stop/file">')

    const ts = await (await get(app, '/recordings/rec-ts')).text()
    expect(ts).not.toContain('<video')
    expect(ts).toContain('Kept as northlight.ts')
  })

  test('unknown player ids render the not-found page with a 404', async () => {
    const { app } = setup()
    const response = await get(app, '/recordings/does-not-exist')
    expect(response.status).toBe(404)
    const page = await response.text()
    for (const marker of ['Not found', 'That recording does not exist.', 'href="/recordings"']) {
      expect(page).toContain(marker)
    }
  })

  test('a hostile handle renders inert', async () => {
    const { app, store } = setup()
    addRecording(store, { id: 'rec-xss', uniqueId: '<script>alert("x")</script>', title: '<b>bold</b>' })
    const page = await (await get(app, '/recordings')).text()
    expect(page).not.toContain('<script>alert')
    expect(page).not.toContain('<b>bold</b>')
    expect(page).toContain('&lt;script&gt;')
  })
})
