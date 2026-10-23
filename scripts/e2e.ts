/**
 * End-to-end proof: real Elysia routes + real engine + real ffmpeg + real disk.
 * Only TikTok resolution is faked (a local FLV stands in for a live HLS feed).
 *
 * Run: bun scripts/e2e.ts
 */
import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import { spawn } from 'bun'
import { Engine } from '../src/engine'
import { createApp } from '../src/server'
import { Store } from '../src/store'
import { TikTokClient } from '../src/tiktok/client'
import type { LiveRoom } from '../src/core/types'
import { FakeResolver, tempDir } from '../tests/helpers'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function makeSample(dir: string): Promise<string> {
  const path = join(dir, 'sample.flv')
  const child = spawn({
    cmd: [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=523:sample_rate=44100',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-f',
      'flv',
      path,
    ],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if ((await child.exited) !== 0) throw new Error(`ffmpeg sample failed: ${await new Response(child.stderr).text()}`)
  return path
}

async function waitFor<T>(label: string, read: () => Promise<T | null> | T | null, timeoutMs = 25_000): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await read()
    if (value) return value
    await sleep(150)
  }
  throw new Error(`timeout waiting for ${label}`)
}

async function inProcess(): Promise<void> {
  const dir = tempDir('tokweb-e2e-')
  const sample = await makeSample(dir)
  const store = new Store({ dataDir: join(dir, 'data'), outputDir: join(dir, 'out') }).load()
  store.state.settings.keepFlv = false
  store.save()
  const room: LiveRoom = {
    status: 'live',
    uniqueId: 'fixturecreator',
    nickname: 'Fixture Creator',
    avatarUrl: null,
    roomId: '7123456789012345678',
    title: 'E2E fixture stream',
    viewers: 42,
    streams: [{ url: sample, format: 'flv', quality: 'HD' }],
  }
  const resolver = new FakeResolver(room)
  const engine = new Engine(store, resolver)
  engine.start()
  const client = new TikTokClient({ retries: 1 })
  const app = createApp({ store, engine, client })

  const post = (path: string, body?: unknown): Promise<Response> =>
    app.handle(
      new Request(`http://tokweb.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )

  const ui = await app.handle(new Request('http://tokweb.test/'))
  assert.equal(ui.status, 200)
  assert.match(await ui.text(), /tokweb/i)
  console.log('✓ GET / serves the dashboard')

  const asset = await app.handle(new Request('http://tokweb.test/assets/app.js'))
  assert.equal(asset.status, 200)
  assert.ok((await asset.text()).includes('EventSource'))
  console.log('✓ static assets served')

  const created = await post('/api/monitors', {
    uniqueId: 'fixturecreator',
    mode: 'automatic',
    variant: 'best',
    intervalSec: 10,
  })
  assert.equal(created.status, 201)
  const monitor = (await created.json()) as { id: string }
  console.log('✓ POST /api/monitors created an automatic monitor')

  const recording = await waitFor('recording to finish', async () => {
    const response = await app.handle(new Request('http://tokweb.test/api/state'))
    const snapshot = (await response.json()) as {
      recordings: Array<{ id: string; state: string; file: string | null; bytes: number; durationMs: number }>
    }
    for (const item of snapshot.recordings) {
      if (item.state === 'completed') return item
      if (item.state === 'failed') throw new Error(`recording failed: ${JSON.stringify(item)}`)
    }
    return null
  })
  assert.ok(recording.id)
  assert.ok(recording.file?.endsWith('.mp4'))
  assert.ok(recording.bytes > 1000)
  const fileName = recording.file
  assert.ok(fileName)
  const filePath = join(store.state.settings.outputDir, fileName)
  assert.ok(await Bun.file(filePath).exists())
  assert.ok(Bun.file(filePath).size > 1000)
  console.log(`✓ ffmpeg captured ${recording.file} (${recording.bytes} bytes)`)

  const ranged = await app.handle(
    new Request(`http://tokweb.test/api/recordings/${recording.id}/file`, {
      headers: { range: 'bytes=0-99' },
    }),
  )
  assert.equal(ranged.status, 206)
  assert.match(ranged.headers.get('content-range') ?? '', /^bytes 0-99\/\d+/)
  assert.equal((await ranged.arrayBuffer()).byteLength, 100)
  console.log('✓ range playback endpoint returns 206 with 100 bytes')

  const stateResponse = await app.handle(new Request('http://tokweb.test/api/state'))
  const state = (await stateResponse.json()) as {
    outputs?: unknown
    settings: Record<string, unknown>
    system: { activeRecordings: number }
    monitors: Array<{ id: string; state: string }>
  }
  assert.equal(state.system.activeRecordings, 0)
  assert.equal(state.monitors[0]?.id, monitor.id)
  assert.equal('cookies' in state.settings, false)
  console.log('✓ snapshot is idle, monitor retained, cookies masked')

  const removed = await app.handle(
    new Request(`http://tokweb.test/api/recordings/${recording.id}`, { method: 'DELETE' }),
  )
  assert.equal(removed.status, 200)
  assert.equal(await Bun.file(filePath).exists(), false)
  console.log('✓ DELETE removes the index entry and the file')

  await engine.stop()
}

async function spawnedServer(): Promise<void> {
  const dir = tempDir('tokweb-spawn-')
  const port = 35_000 + Math.floor(Math.random() * 10_000)
  const child = spawn({
    cmd: ['bun', 'src/index.ts', '-port', String(port), '-data_dir', join(dir, 'data'), '-output', join(dir, 'out')],
    cwd: join(import.meta.dir, '..'),
    env: { ...process.env, TOKWEB_DATA: join(dir, 'data') },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const base = `http://127.0.0.1:${port}`
  try {
    await waitFor(
      'server boot',
      async () => {
        try {
          const response = await fetch(`${base}/api/health`)
          return response.ok ? true : null
        } catch {
          return null
        }
      },
      15_000,
    )
    const page = await fetch(`${base}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /Never miss/)
    const state = await fetch(`${base}/api/state`)
    assert.equal(state.status, 200)
    const body = (await state.json()) as { system: { bun: string } }
    assert.ok(body.system.bun.length > 0)
    console.log(`✓ spawned CLI server booted on :${port} and served the dashboard`)

    const events = await fetch(`${base}/api/events`)
    assert.equal(events.status, 200)
    const reader = events.body?.getReader()
    assert.ok(reader)
    await reader.read()
    child.kill('SIGINT')
    const stopped = await Promise.race([child.exited.then(() => true), sleep(8_000).then(() => false)])
    await reader.cancel().catch(() => undefined)
    assert.equal(stopped, true, 'server must exit on SIGINT while a dashboard stream is open')
    console.log('✓ spawned CLI server exits on SIGINT with a dashboard stream open')
  } finally {
    child.kill('SIGINT')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
    await child.exited
    clearTimeout(timeout)
  }
}

console.log('tokweb end-to-end proof')
await inProcess()
await spawnedServer()
console.log('E2E VERIFIED')
