import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Engine } from '../src/engine'
import { Store } from '../src/store'
import { FakeResolver, fakeRecorderFactory, liveRoom, tempDir } from './helpers'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function setup(room = liveRoom()) {
  const dir = tempDir()
  const store = new Store({ dataDir: join(dir, 'data'), outputDir: join(dir, 'out') }).load()
  const resolver = new FakeResolver(room)
  const recorder = fakeRecorderFactory()
  const engine = new Engine(store, resolver, { recorder: recorder.factory })
  return { dir, store, resolver, recorder, engine }
}

describe('Engine', () => {
  test('automatic mode records when live and finalizes the job', async () => {
    const { store, recorder, engine } = setup()
    engine.start()
    const monitor = await engine.addMonitor({ uniqueId: 'streamer', mode: 'automatic', intervalSec: 10 })
    await sleep(40)

    expect(recorder.handles).toHaveLength(1)
    expect(monitor.state).toBe('recording')
    const recording = store.state.recordings[0]
    expect(recording?.state).toBe('recording')
    expect(recorder.handles[0]?.options.url).toBe('https://cdn.example.com/live/hd.flv')

    recorder.handles[0]?.finish()
    await sleep(20)
    expect(recording?.state).toBe('completed')
    expect(recording?.file).toEndWith('.mp4')
    expect(monitor.recordingId).toBeNull()
    await engine.stop()
  })

  test('recordNow is idempotent while a recording is active', async () => {
    const { engine, recorder } = setup()
    engine.start()
    const monitor = await engine.addMonitor({ uniqueId: 'streamer', mode: 'manual' })
    const first = await engine.recordNow(monitor.id)
    const second = await engine.recordNow(monitor.id)
    expect(second.id).toBe(first.id)
    expect(recorder.handles).toHaveLength(1)
    await engine.stop()
  })

  test('refuses to record an offline creator', async () => {
    const { engine } = setup(liveRoom({ status: 'offline' }))
    engine.start()
    const monitor = await engine.addMonitor({ uniqueId: 'streamer', mode: 'manual' })
    expect(engine.recordNow(monitor.id)).rejects.toThrow('not live')
    await engine.stop()
  })

  test('manual monitors do not auto-record', async () => {
    const { engine, recorder } = setup()
    engine.start()
    await engine.addMonitor({ uniqueId: 'streamer', mode: 'manual' })
    await sleep(50)
    expect(recorder.handles).toHaveLength(0)
    await engine.stop()
  })

  test('stopRecording marks the job cancelled and keeps the monitor', async () => {
    const { store, engine } = setup()
    engine.start()
    const monitor = await engine.addMonitor({ uniqueId: 'streamer', mode: 'manual' })
    const recording = await engine.recordNow(monitor.id)
    const stopped = await engine.stopRecording(recording.id)
    expect(stopped?.state).toBe('cancelled')
    expect(store.state.monitors).toHaveLength(1)
    await engine.stop()
  })

  test('adding the same creator updates the existing monitor', async () => {
    const { store, engine } = setup()
    engine.start()
    const first = await engine.addMonitor({ uniqueId: '@Streamer', mode: 'manual' })
    const second = await engine.addMonitor({ uniqueId: 'streamer', mode: 'automatic', intervalSec: 30 })
    expect(second.id).toBe(first.id)
    expect(store.state.monitors).toHaveLength(1)
    expect(second.mode).toBe('automatic')
    await engine.stop()
  })
})

describe('Engine followers mode', () => {
  test('starts recordings for live followed creators', async () => {
    const { store, recorder } = setup()
    const resolver = new (class {
      async resolve(input: { uniqueId?: string | null }) {
        return liveRoom({ uniqueId: input.uniqueId ?? 'unknown', roomId: `room-${input.uniqueId}` })
      }
      async following() {
        return [
          { uniqueId: 'one', secUid: null },
          { uniqueId: 'two', secUid: null },
        ]
      }
    })()
    const followerEngine = new Engine(store, resolver, { recorder: recorder.factory })
    followerEngine.start()
    await followerEngine.addMonitor({ uniqueId: 'owner', mode: 'followers', intervalSec: 10 })
    await sleep(80)
    expect(recorder.handles).toHaveLength(2)
    expect(store.state.recordings).toHaveLength(2)
    await followerEngine.stop()
  })
})
