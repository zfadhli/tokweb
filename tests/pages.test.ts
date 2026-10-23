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
      'On watch',
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
