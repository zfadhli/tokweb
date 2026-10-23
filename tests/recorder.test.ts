import { describe, expect, test } from 'bun:test'
import { spawn } from 'bun'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { startRecorder } from '../src/recorder/ffmpeg'
import { tempDir } from './helpers'

const ffmpeg = Bun.which('ffmpeg')

async function makeSample(path: string): Promise<void> {
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
      'testsrc2=size=320x240:rate=15',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '3',
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
  const code = await child.exited
  if (code !== 0) throw new Error(`sample generation failed: ${await new Response(child.stderr).text()}`)
}

describe('ffmpeg recorder', () => {
  test('records, reports progress, remuxes to mp4, and removes the flv', async () => {
    if (!ffmpeg) return
    const dir = tempDir()
    const sample = join(dir, 'sample.flv')
    await makeSample(sample)
    const outputBase = join(dir, 'out', 'streamer_123')
    const progress: number[] = []

    const handle = startRecorder({
      url: sample,
      outputBase,
      durationSec: 3,
      keepFlv: false,
      onProgress: (event) => progress.push(event.bytes),
    })
    const result = await handle.done

    expect(result.ok).toBe(true)
    expect(result.error).toBeNull()
    expect(result.file).toBe(`${outputBase}.mp4`)
    expect(existsSync(result.file!)).toBe(true)
    expect(statSync(result.file!).size).toBeGreaterThan(1000)
    expect(existsSync(`${outputBase}.flv`)).toBe(false)
    expect(progress.length).toBeGreaterThan(0)
  }, 30_000)

  test('stop finalizes a usable file', async () => {
    if (!ffmpeg) return
    const dir = tempDir()
    const sample = join(dir, 'sample.flv')
    await makeSample(sample)
    // A named pipe keeps ffmpeg reading while we stop it, like a live feed.
    const fifo = join(dir, 'feed.flv')
    mkdirSync(join(dir, 'out'), { recursive: true })
    const mkfifo = spawn({ cmd: ['mkfifo', fifo], stdout: 'ignore', stderr: 'ignore' })
    await mkfifo.exited

    const outputBase = join(dir, 'out', 'stopped')
    const handle = startRecorder({ url: fifo, outputBase, keepFlv: true })
    // Hold the fifo open while ffmpeg is stopped, like a live feed.
    const pump = spawn({ cmd: ['sh', '-c', `(cat "${sample}"; sleep 2) > "${fifo}"`], stdout: 'ignore', stderr: 'ignore' })
    await new Promise((resolve) => setTimeout(resolve, 700))
    const result = await handle.stop()
    await pump.exited
    expect(result.ok).toBe(true)
    expect(result.bytes).toBeGreaterThan(0)
    expect(existsSync(`${outputBase}.flv`)).toBe(true)
  }, 30_000)
})
