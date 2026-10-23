import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Engine, type EngineOptions } from '../src/engine'
import { Store } from '../src/store'
import { FakeResolver, fakeRecorderFactory, liveRoom, tempDir } from './helpers'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function setup(room = liveRoom(), engineOptions: EngineOptions = {}) {
  const dir = tempDir()
  const store = new Store({ dataDir: join(dir, 'data'), outputDir: join(dir, 'out') }).load()
  const resolver = new FakeResolver(room)
  const recorder = fakeRecorderFactory()
  const engine = new Engine(store, resolver, { recorder: recorder.factory, ...engineOptions })
  return { dir, store, resolver, recorder, engine }
}

describe('Engine', () => {
  test('automatic mode records when live and finalizes the job', async () => {
    const { store, recorder, engine } = setup()
    engine.start()
    const monitor = await engine.addMonitor({
      uniqueId: 'streamer',
      mode: 'automatic',
      intervalSec: 10,
      autoRecord: true,
    })
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

  test('new monitors default to a 3 minute poll with auto-record off', async () => {
    const { engine, recorder } = setup()
    engine.start()
    const monitor = await engine.addMonitor({ uniqueId: 'streamer', mode: 'automatic' })
    await sleep(40)

    expect(monitor.intervalSec).toBe(180)
    expect(monitor.autoRecord).toBe(false)
    expect(recorder.handles).toHaveLength(0)
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

describe('Engine boot stagger', () => {
  async function seedThree(engine: Engine) {
    for (const uniqueId of ['one', 'two', 'three']) {
      await engine.addMonitor({ uniqueId, mode: 'automatic', intervalSec: 30 })
    }
  }

  test('spreads the first checks of a boot sweep', async () => {
    const { resolver, engine } = setup(liveRoom({ status: 'offline' }), { bootStaggerMs: 80 })
    await seedThree(engine)
    engine.start()
    await sleep(320)

    expect(resolver.calls).toBe(3)
    const gaps = resolver.callTimes.slice(1).map((at, index) => at - resolver.callTimes[index]!)
    const span = resolver.callTimes.at(-1)! - resolver.callTimes[0]!
    console.log('boot stagger gaps ms:', gaps.join(', '), '| span ms:', span)
    expect(span).toBeGreaterThan(100)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(40)
    await engine.stop()
  })

  test('bootStaggerMs 0 disables the spread', async () => {
    const { resolver, engine } = setup(liveRoom({ status: 'offline' }), { bootStaggerMs: 0 })
    await seedThree(engine)
    engine.start()
    await sleep(60)

    expect(resolver.calls).toBe(3)
    const span = resolver.callTimes.at(-1)! - resolver.callTimes[0]!
    console.log('stagger off span ms:', span)
    expect(span).toBeLessThan(50)
    await engine.stop()
  })

  test('staggers monitors seeded after boot, the CLI path', async () => {
    const { resolver, engine } = setup(liveRoom({ status: 'offline' }), { bootStaggerMs: 80 })
    engine.start()
    await seedThree(engine)
    await sleep(320)

    expect(resolver.calls).toBe(3)
    const gaps = resolver.callTimes.slice(1).map((at, index) => at - resolver.callTimes[index]!)
    console.log('seed stagger gaps ms:', gaps.join(', '))
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(40)
    await engine.stop()
  })

  test('a monitor rescheduled after its first check fires immediately', async () => {
    const { store, resolver, engine } = setup(liveRoom({ status: 'offline' }), { bootStaggerMs: 80 })
    await seedThree(engine)
    engine.start()
    await sleep(320)
    const monitor = store.state.monitors.find((item) => item.uniqueId === 'one')!

    const before = resolver.callTimes.length
    engine.updateMonitor(monitor.id, { intervalSec: 45 })
    await sleep(30)

    expect(resolver.callTimes.length).toBe(before + 1)
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
    await followerEngine.addMonitor({
      uniqueId: 'owner',
      mode: 'followers',
      intervalSec: 10,
      autoRecord: true,
    })
    await sleep(80)
    expect(recorder.handles).toHaveLength(2)
    expect(store.state.recordings).toHaveLength(2)
    await followerEngine.stop()
  })
})
