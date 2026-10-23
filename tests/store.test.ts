import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Store } from '../src/store'
import { tempDir } from './helpers'

describe('Store', () => {
  test('creates state, resolves paths, and persists round-trip', () => {
    const dir = tempDir()
    const output = join(dir, 'out')
    const store = new Store({ dataDir: join(dir, 'data'), outputDir: output }).load()
    expect(existsSync(join(dir, 'data', 'state.json'))).toBe(true)
    expect(store.state.settings.outputDir).toBe(output)
    expect(store.state.settings.defaultVariant).toBe('best')

    store.state.monitors.push({
      id: 'm1',
      uniqueId: 'alice',
      roomId: null,
      mode: 'manual',
      variant: 'best',
      autoRecord: false,
      intervalSec: 60,
      maxDurationSec: null,
      state: 'idle',
      live: false,
      title: '',
      viewers: 0,
      avatarUrl: null,
      lastCheckedAt: null,
      lastError: null,
      recordingId: null,
      createdAt: 1,
      updatedAt: 1,
    })
    store.save()

    const reloaded = new Store({ dataDir: join(dir, 'data'), outputDir: output }).load()
    expect(reloaded.state.monitors).toHaveLength(1)
    expect(reloaded.state.monitors[0]?.uniqueId).toBe('alice')
  })

  test('marks interrupted jobs failed on load', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    const output = join(dir, 'out')
    mkdirSync(data, { recursive: true })
    mkdirSync(output, { recursive: true })
    const state = {
      version: 1,
      settings: {
        outputDir: output,
        ffmpegPath: 'ffmpeg',
        cookies: '',
        proxy: '',
        userAgent: '',
        defaultVariant: 'best',
        defaultIntervalSec: 60,
        bitrate: '',
        keepFlv: false,
      },
      monitors: [],
      recordings: [
        {
          id: 'r1',
          monitorId: null,
          uniqueId: 'alice',
          roomId: null,
          title: '',
          variant: 'best',
          state: 'recording',
          file: null,
          startedAt: Date.now() - 10_000,
          endedAt: null,
          durationMs: 0,
          bytes: 100,
          error: null,
        },
      ],
    }
    writeFileSync(join(data, 'state.json'), JSON.stringify(state))

    const store = new Store({ dataDir: data, outputDir: output }).load()
    expect(store.state.recordings[0]?.state).toBe('failed')
    expect(store.state.recordings[0]?.error).toContain('Interrupted')
    const saved = JSON.parse(readFileSync(join(data, 'state.json'), 'utf8'))
    expect(saved.recordings[0].state).toBe('failed')
  })

  test('adopts recordings that exist on disk before a restart', () => {
    const dir = tempDir()
    const output = join(dir, 'out')
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'bob_7000000000000000009_2026-01-02_03-04-05.mp4'), 'not a real video')
    const store = new Store({ dataDir: join(dir, 'data'), outputDir: output }).load()
    const adopted = store.state.recordings.find((recording) => recording.uniqueId === 'bob')
    expect(adopted?.state).toBe('completed')
    expect(adopted?.file).toBe('bob_7000000000000000009_2026-01-02_03-04-05.mp4')
    expect(adopted?.roomId).toBe('7000000000000000009')
    expect(store.recordingPath(adopted!)).toBe(join(output, adopted!.file!))
  })
})
