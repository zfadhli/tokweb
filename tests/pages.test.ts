import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Engine } from '../src/engine'
import { createApp } from '../src/server'
import { Store } from '../src/store'
import { TikTokClient } from '../src/tiktok/client'
import type { Monitor, Recording } from '../src/core/types'
import { FakeResolver, fakeRecorderFactory, liveRoom, tempDir } from './helpers'

function setup() {
  const dir = tempDir()
  const store = new Store({ dataDir: join(dir, 'data'), outputDir: join(dir, 'out') }).load()
  const recorder = fakeRecorderFactory()
  const engine = new Engine(store, new FakeResolver(liveRoom()), { recorder: recorder.factory })
  const app = createApp({ store, engine, client: new TikTokClient() })
  return { dir, store, engine, app }
}

function addMonitor(store: Store, overrides: Partial<Monitor> = {}): Monitor {
  const monitor: Monitor = {
    id: `mon-${store.state.monitors.length + 1}`,
    uniqueId: 'aurorabeats',
    roomId: null,
    variant: 'best',
    autoRecord: true,
    intervalSec: 180,
    maxDurationSec: null,
    state: 'waiting',
    live: false,
    title: '',
    viewers: 0,
    avatarUrl: null,
    lastCheckedAt: null,
    lastError: null,
    recordingId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
  store.state.monitors.push(monitor)
  return monitor
}

function addRecording(store: Store, dir: string, overrides: Partial<Recording> = {}): Recording {
  mkdirSync(store.state.settings.outputDir, { recursive: true })
  const file = 'aurorabeats_20260707_140509.mp4'
  writeFileSync(join(store.state.settings.outputDir, file), 'video-bytes')
  const recording: Recording = {
    id: 'rec-1',
    monitorId: 'mon-1',
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

describe('server-rendered pages', () => {
  test('home renders the full shell, stats, and empty archive state', async () => {
    const { app } = setup()
    const response = await get(app, '/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()

    for (const marker of [
      '<!doctype html>',
      'href="/assets/app.css"',
      'src="/vendor/htmx.js"',
      'src="/vendor/alpine.js"',
      'href="/watch"',
      'href="/recordings"',
      'href="/admin"',
      'Archive at a glance',
      'Latest captures',
      'Nothing captured yet.',
      'Last 7 days',
      'Top creators',
    ]) {
      expect(html).toContain(marker)
    }
    expect(html).not.toContain('EventSource')
  })

  test('home lists monitors and completed recordings', async () => {
    const { app, store, dir } = setup()
    addMonitor(store, { state: 'recording', live: true, recordingId: 'rec-1', viewers: 99 })
    addRecording(store, dir, { state: 'completed' })
    const html = await (await get(app, '/')).text()

    expect(html).toContain('@aurorabeats')
    expect(html).toContain('Night session')
    expect(html).toContain('1 file')
    expect(html).toContain('03:00')
    expect(html).toContain('recording')
  })

  test('home ranks the four creators with the most kept files', async () => {
    const { app, store, dir } = setup()
    const counts = [
      ['heavy', 4, 400],
      ['mid', 3, 300],
      ['light', 2, 200],
      ['extra', 1, 200],
      ['spare', 1, 100],
    ] as const
    let index = 0
    for (const [handle, count, bytes] of counts) {
      for (let n = 0; n < count; n += 1) {
        index += 1
        addRecording(store, dir, {
          id: `rec-${index}`,
          uniqueId: handle,
          file: `${handle}_${index}.mp4`,
          bytes,
        })
      }
    }
    const html = await (await get(app, '/')).text()
    const panel = html.slice(html.indexOf('Top creators'), html.indexOf('Latest captures'))
    const order = ['@heavy', '@mid', '@light', '@extra', '@spare'].map((marker) => panel.indexOf(marker))

    expect(order.slice(0, 4).every((position) => position > -1)).toBe(true)
    expect([...order.slice(0, 4)].sort((a, b) => a - b)).toEqual(order.slice(0, 4))
    expect(order[4]).toBe(-1)
    expect(panel).toContain('4 files')
  })

  test('creator cards carry the monitor avatar and fall back to initials', async () => {
    const { app, store, dir } = setup()
    addMonitor(store, { uniqueId: 'avatared', avatarUrl: 'https://cdn.example.com/a.jpg' })
    addRecording(store, dir, { uniqueId: 'avatared' })
    addRecording(store, dir, { id: 'rec-2', uniqueId: 'plain', file: 'plain.mp4' })
    const html = await (await get(app, '/')).text()
    const panel = html.slice(html.indexOf('Top creators'), html.indexOf('Latest captures'))

    expect(panel).toContain('class="capture-avatar" src="https://cdn.example.com/a.jpg"')
    expect(panel.match(/class="capture-avatar"/g)?.length).toBe(1)
    expect(panel).toContain('>PL</span>')
  })

  test('home capture cards request generated thumbnails', async () => {
    const { app, store, dir } = setup()
    addRecording(store, dir)
    const html = await (await get(app, '/')).text()

    expect(html).toContain('class="capture-thumb" src="/api/recordings/rec-1/thumb"')
  })

  test('week chart scales each bar to the peak day', async () => {
    const { app, store, dir } = setup()
    const day = 86_400_000
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    addRecording(store, dir, { bytes: 1000, startedAt: today.getTime(), endedAt: today.getTime() + 1000 })
    addRecording(store, dir, {
      id: 'rec-2',
      file: 'half.mp4',
      bytes: 500,
      startedAt: today.getTime() - 2 * day,
      endedAt: today.getTime() - 2 * day + 1000,
    })
    const html = await (await get(app, '/')).text()

    expect(html).toContain('class="bar-spacer" style="flex-grow: 0"></span><span class="bar-fill" style="flex-grow: 100"')
    expect(html).toContain('class="bar-spacer" style="flex-grow: 50"></span><span class="bar-fill" style="flex-grow: 50"')
    expect(html).toContain('class="bar-spacer" style="flex-grow: 100"></span><span class="bar-fill" style="flex-grow: 0"')
  })

  test('active captures surface a recording count in the chrome', async () => {
    const { app, engine, store } = setup()
    addMonitor(store, { id: 'mon-live', uniqueId: 'aurorabeats', state: 'live', live: true })
    store.save()
    await engine.recordNow('mon-live')
    const html = await (await get(app, '/')).text()
    expect(html).toContain('1 recording')
    expect(engine.activeCount).toBe(1)
  })

  test('vendor scripts and stylesheet are served from their packages', async () => {
    const { app } = setup()
    for (const path of ['/assets/app.css', '/assets/app.js', '/vendor/htmx.js', '/vendor/alpine.js', '/vendor/htmx-alpine.js']) {
      const response = await get(app, path)
      expect(response.status).toBe(200)
      expect((await response.text()).length).toBeGreaterThan(20)
    }
    expect((await get(app, '/vendor/unknown.js')).status).toBe(404)
  })

  test('unknown pages 404 instead of rendering the shell', async () => {
    const { app } = setup()
    const response = await get(app, '/does-not-exist')
    expect(response.status).toBe(404)
  })
})
