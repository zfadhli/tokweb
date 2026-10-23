/**
 * Deterministic page fixture: real routes, fake archive, no polling.
 * `bun scripts/fixture.ts [-port 4100] [-dir /tmp/tokweb-fixture]`
 */
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Engine } from '../src/engine'
import { createApp } from '../src/server'
import { Store } from '../src/store'
import { TikTokClient } from '../src/tiktok/client'
import type { AppState, Monitor, Recording } from '../src/core/types'
import { FakeResolver, fakeRecorderFactory, liveRoom } from '../tests/helpers'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const index = args.indexOf(name)
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback
}

const port = Number(flag('-port', '4100'))
const dir = resolve(flag('-dir', '/tmp/tokweb-fixture'))
const outputDir = join(dir, 'out')
const dataDir = join(dir, 'data')

async function ensureSample(name: string): Promise<string> {
  const path = join(outputDir, name)
  if (existsSync(path)) return path
  const child = Bun.spawn({
    cmd: [
      'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=420:sample_rate=44100',
      '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', path,
    ],
    stdout: 'ignore',
    stderr: 'inherit',
  })
  if ((await child.exited) !== 0) throw new Error(`ffmpeg failed for ${name}`)
  return path
}

const now = Date.now()
const minute = 60_000
const hour = 45 * minute

function monitor(overrides: Partial<Monitor> & Pick<Monitor, 'id' | 'uniqueId'>): Monitor {
  return {
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
    lastCheckedAt: now - 4 * minute,
    lastError: null,
    recordingId: null,
    createdAt: now - 6 * hour,
    updatedAt: now - 4 * minute,
    ...overrides,
  }
}

function recording(file: string, overrides: Partial<Recording> & Pick<Recording, 'id' | 'uniqueId' | 'startedAt'>): Recording {
  const bytes = statSync(join(outputDir, file)).size
  return {
    monitorId: null,
    roomId: null,
    title: '',
    variant: 'best',
    state: 'completed',
    file,
    endedAt: overrides.startedAt + 3 * minute,
    durationMs: 3 * minute,
    bytes,
    error: null,
    ...overrides,
  }
}

async function main(): Promise<void> {
  mkdirSync(outputDir, { recursive: true })
  for (const name of ['aurora.mp4', 'pixel.mp4', 'north.mp4', 'velvet.mp4']) await ensureSample(name)

  const state: AppState = {
    version: 1,
    settings: {
      outputDir,
      ffmpegPath: 'ffmpeg',
      cookies: '',
      proxy: '',
      userAgent: '',
      defaultVariant: 'best',
      defaultIntervalSec: 180,
      defaultMaxDurationSec: 7200,
      bitrate: '',
      keepSource: false,
    },
    monitors: [
      monitor({
        id: 'mon-aurora',
        uniqueId: 'aurorabeats',
        variant: 'hd',
        state: 'live',
        live: true,
        title: 'Night session · analog synths and a room full of people',
        viewers: 1842,
        lastCheckedAt: now - 20_000,
      }),
      monitor({
        id: 'mon-pixel',
        uniqueId: 'pixelgarden',
        state: 'live',
        live: true,
        title: 'Building a greenhouse out of scrap windows',
        viewers: 327,
        intervalSec: 300,
        lastCheckedAt: now - 70_000,
        updatedAt: now - 70_000,
      }),
      monitor({
        id: 'mon-north',
        uniqueId: 'northlight',
        variant: 'audio',
        state: 'waiting',
        autoRecord: false,
        intervalSec: 600,
        lastCheckedAt: now - 8 * minute,
        updatedAt: now - 8 * minute,
      }),
      monitor({
        id: 'mon-dnb',
        uniqueId: 'drumandbass',
        state: 'error',
        lastError: 'TikTok resolver returned 403 for this region',
        lastCheckedAt: now - 2 * minute,
        updatedAt: now - 2 * minute,
      }),
      monitor({
        id: 'mon-velvet',
        uniqueId: 'velvetroom',
        state: 'waiting',
        maxDurationSec: 3600,
        lastCheckedAt: now - 12 * minute,
        updatedAt: now - 12 * minute,
      }),
    ],
    recordings: [
      recording('aurora.mp4', {
        id: 'rec-aurora',
        monitorId: 'mon-aurora',
        uniqueId: 'aurorabeats',
        title: 'Night session · analog synths',
        variant: 'hd',
        startedAt: now - 26 * minute,
        endedAt: now - 23 * minute,
        durationMs: 3 * minute,
      }),
      recording('pixel.mp4', {
        id: 'rec-pixel',
        monitorId: 'mon-pixel',
        uniqueId: 'pixelgarden',
        title: 'Greenhouse build, day four',
        startedAt: now - 5 * hour,
        endedAt: now - 5 * hour + 48 * minute,
        durationMs: 48 * minute,
      }),
      recording('north.mp4', {
        id: 'rec-north',
        monitorId: 'mon-north',
        uniqueId: 'northlight',
        title: 'Late radio set',
        variant: 'audio',
        startedAt: now - 29 * hour,
        endedAt: now - 29 * hour + 2 * hour,
        durationMs: 2 * hour,
      }),
      recording('velvet.mp4', {
        id: 'rec-velvet',
        monitorId: 'mon-velvet',
        uniqueId: 'velvetroom',
        title: 'Studio walkthrough',
        startedAt: now - 55 * hour,
        endedAt: now - 55 * hour + 27 * minute,
        durationMs: 27 * minute,
      }),
      {
        id: 'rec-failed',
        monitorId: 'mon-dnb',
        uniqueId: 'drumandbass',
        roomId: null,
        title: 'Rooftop set',
        variant: 'best',
        state: 'failed',
        file: null,
        startedAt: now - 70 * hour,
        endedAt: now - 70 * hour + 40_000,
        durationMs: 40_000,
        bytes: 0,
        error: 'ffmpeg exited with code 1',
      },
    ],
  }

  const store = new Store({ dataDir, outputDir }).load()
  store.state = state
  store.save()
  const room = liveRoom({
    uniqueId: 'aurorabeats',
    nickname: 'Aurora Beats',
    title: 'Night session · analog synths and a room full of people',
    viewers: 1842,
  })
  const recorder = fakeRecorderFactory()
  const engine = new Engine(store, new FakeResolver(room), { recorder: recorder.factory })
  await engine.recordNow('mon-aurora')
  const app = createApp({ store, engine, client: new TikTokClient() })
  app.listen({ port, hostname: '127.0.0.1' })
  console.log(`fixture http://127.0.0.1:${port} (data ${dataDir})`)
  process.on('SIGINT', () => {
    app.stop(true)
    process.exit(0)
  })
  await new Promise(() => undefined)
}

await main()
