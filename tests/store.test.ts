import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Store } from '../src/store'
import type { Recording } from '../src/core/types'
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
      variant: 'best',
      autoRecord: false,
      intervalSec: 180,
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

  test('drops the retired mode field from stored monitors', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    mkdirSync(data, { recursive: true })
    writeFileSync(
      join(data, 'state.json'),
      JSON.stringify({
        version: 1,
        settings: { outputDir: join(dir, 'out') },
        monitors: [{ id: 'm1', uniqueId: 'alice', mode: 'followers', createdAt: 1, intervalSec: 60 }],
        recordings: [],
      }),
    )
    const store = new Store({ dataDir: data, outputDir: join(dir, 'out') }).load()
    expect(store.state.monitors[0]?.uniqueId).toBe('alice')
    expect(store.state.monitors[0] && 'mode' in store.state.monitors[0]).toBe(false)
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
        keepSource: false,
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

  test('attaches an interrupted capture\'s source file instead of adopting it twice', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    const output = join(dir, 'out')
    mkdirSync(data, { recursive: true })
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'alice_20260102_030405.ts'), 'ts-bytes')
    writeFileSync(
      join(data, 'state.json'),
      JSON.stringify({
        version: 1,
        settings: { outputDir: output },
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
            startedAt: new Date(2026, 0, 2, 3, 4, 5).getTime() + 191,
            endedAt: null,
            durationMs: 0,
            bytes: 0,
            error: null,
          },
        ],
      }),
    )
    const store = new Store({ dataDir: data, outputDir: output }).load()
    expect(store.state.recordings).toHaveLength(1)
    expect(store.state.recordings[0]?.file).toBe('alice_20260102_030405.ts')
    expect(store.state.recordings[0]?.bytes).toBe(8)
  })

  test('collapses a disk-adopted twin into the interrupted recording', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    const output = join(dir, 'out')
    mkdirSync(data, { recursive: true })
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'alice_20260102_030405.ts'), 'ts-bytes')
    const startedAt = new Date(2026, 0, 2, 3, 4, 5).getTime()
    const base = {
      monitorId: null,
      roomId: null,
      title: '',
      variant: 'best',
      durationMs: 0,
      bytes: 0,
      error: 'Interrupted by server restart',
    }
    writeFileSync(
      join(data, 'state.json'),
      JSON.stringify({
        version: 1,
        settings: { outputDir: output },
        monitors: [],
        recordings: [
          { ...base, id: 'r1', uniqueId: 'alice', state: 'failed', file: null, startedAt: startedAt + 191, endedAt: startedAt + 60_000 },
          { ...base, id: 'disk-abc', uniqueId: 'alice', state: 'completed', file: 'alice_20260102_030405.ts', startedAt, endedAt: startedAt + 60_000, bytes: 8 },
        ],
      }),
    )
    const store = new Store({ dataDir: data, outputDir: output }).load()
    expect(store.state.recordings).toHaveLength(1)
    expect(store.state.recordings[0]?.id).toBe('r1')
    expect(store.state.recordings[0]?.file).toBe('alice_20260102_030405.ts')
    expect(store.recordingPath(store.state.recordings[0]!)).toBe(join(output, 'alice_20260102_030405.ts'))
  })

  test('drops a settled recording whose file was deleted from disk', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    const output = join(dir, 'out')
    mkdirSync(join(data, 'thumbs'), { recursive: true })
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'kept.mp4'), 'video-bytes')
    writeFileSync(join(data, 'thumbs', 'gone.jpg'), 'jpeg-bytes')
    writeFileSync(join(data, 'thumbs', 'kept.jpg'), 'jpeg-bytes')
    const base = {
      monitorId: null,
      uniqueId: 'alice',
      roomId: null,
      title: '',
      variant: 'best',
      endedAt: 2000,
      durationMs: 1000,
      bytes: 12,
      error: null,
    }
    writeFileSync(
      join(data, 'state.json'),
      JSON.stringify({
        version: 1,
        settings: { outputDir: output },
        monitors: [],
        recordings: [
          { ...base, id: 'gone', state: 'completed', file: 'gone.mp4', startedAt: 1000 },
          { ...base, id: 'kept', state: 'completed', file: 'kept.mp4', startedAt: 2000 },
        ],
      }),
    )

    const store = new Store({ dataDir: data, outputDir: output }).load()

    expect(store.state.recordings.map((recording) => recording.id)).toEqual(['kept'])
    expect(existsSync(join(data, 'thumbs', 'gone.jpg'))).toBe(false)
    expect(existsSync(join(data, 'thumbs', 'kept.jpg'))).toBe(true)
  })

  test('sync heals the index while a live capture is left alone', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    const output = join(dir, 'out')
    mkdirSync(data, { recursive: true })
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'kept.mp4'), 'video-bytes')
    const base: Omit<Recording, 'id' | 'state' | 'file' | 'startedAt' | 'endedAt'> = {
      monitorId: null,
      uniqueId: 'alice',
      roomId: null,
      title: '',
      variant: 'best',
      durationMs: 1000,
      bytes: 12,
      error: null,
    }
    writeFileSync(
      join(data, 'state.json'),
      JSON.stringify({
        version: 1,
        settings: { outputDir: output },
        monitors: [],
        recordings: [{ ...base, id: 'kept', state: 'completed', file: 'kept.mp4', startedAt: 1000, endedAt: 2000 }],
      }),
    )
    const store = new Store({ dataDir: data, outputDir: output }).load()
    store.state.recordings.push(
      { ...base, id: 'live', state: 'recording', file: 'live.ts', startedAt: 3000, endedAt: null },
      { ...base, id: 'gone', state: 'completed', file: 'gone.mp4', startedAt: 4000, endedAt: 5000 },
    )
    writeFileSync(join(output, 'fresh.mp4'), 'new-bytes')

    expect(store.sync()).toBe(true)

    const ids = store.state.recordings.map((recording) => recording.id)
    expect(ids).toContain('kept')
    expect(ids).toContain('live')
    expect(ids.some((id) => id.startsWith('disk-'))).toBe(true)
    expect(ids).not.toContain('gone')
    expect(store.state.recordings.find((recording) => recording.id === 'live')?.state).toBe('recording')
    expect(store.sync()).toBe(false)
  })

  test('drops an interrupted capture whose file never landed', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    const output = join(dir, 'out')
    mkdirSync(data, { recursive: true })
    mkdirSync(output, { recursive: true })
    writeFileSync(
      join(data, 'state.json'),
      JSON.stringify({
        version: 1,
        settings: { outputDir: output },
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
            file: 'alice_20260102_030405.ts',
            startedAt: Date.now() - 10_000,
            endedAt: null,
            durationMs: 0,
            bytes: 0,
            error: null,
          },
        ],
      }),
    )

    const store = new Store({ dataDir: data, outputDir: output }).load()

    expect(store.state.recordings).toHaveLength(0)
  })

  test('drops a failed capture whose file was deleted from disk', () => {
    const dir = tempDir()
    const data = join(dir, 'data')
    const output = join(dir, 'out')
    mkdirSync(data, { recursive: true })
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'alive.mp4'), 'video-bytes')
    const base = {
      monitorId: null,
      roomId: null,
      title: '',
      variant: 'best' as const,
      durationMs: 1000,
      bytes: 12,
      error: null,
    }
    writeFileSync(
      join(data, 'state.json'),
      JSON.stringify({
        version: 1,
        settings: { outputDir: output },
        monitors: [],
        recordings: [
          {
            ...base,
            id: 'r1',
            uniqueId: '600',
            state: 'failed',
            file: '600_1031_20261023_194302.mp4',
            startedAt: 1000,
            endedAt: 2000,
            error: 'ffmpeg exited with code 1',
          },
          { ...base, id: 'r2', uniqueId: 'alice', state: 'completed', file: 'alive.mp4', startedAt: 3000, endedAt: 4000 },
        ],
      }),
    )

    const store = new Store({ dataDir: data, outputDir: output }).load()

    expect(store.state.recordings.map((recording) => recording.id)).toEqual(['r2'])
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
