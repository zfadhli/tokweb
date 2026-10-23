import { spawn, type Subprocess } from 'bun'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

export interface RecorderProgress {
  bytes: number
  durationMs: number
  speed: number
}

export interface RecorderOptions {
  url: string
  /** Absolute path without extension. */
  outputBase: string
  ffmpegPath?: string
  durationSec?: number | null
  bitrate?: string | null
  proxy?: string
  userAgent?: string
  keepSource?: boolean
  audioOnly?: boolean
  onProgress?: (progress: RecorderProgress) => void
}

export interface RecorderResult {
  ok: boolean
  /** Playable file, relative to the output directory. */
  file: string | null
  sourceFile: string | null
  bytes: number
  durationMs: number
  code: number | null
  error: string | null
}

export interface RecorderHandle {
  readonly sourcePath: string
  stop(): Promise<RecorderResult>
  readonly done: Promise<RecorderResult>
}

export type RecorderFactory = (options: RecorderOptions) => RecorderHandle

const STOP_GRACE_MS = 8_000

function baseArgs(ffmpegPath: string): string[] {
  return [ffmpegPath, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-progress', 'pipe:1', '-stats_period', '0.5']
}

function parseProgress(line: string, block: Record<string, string>): boolean {
  const index = line.indexOf('=')
  if (index < 0) return false
  const key = line.slice(0, index)
  const value = line.slice(index + 1)
  block[key] = value
  return key === 'progress'
}

function toProgress(block: Record<string, string>): RecorderProgress {
  const us = Number(block.out_time_us ?? block.out_time_ms ?? 0)
  return {
    bytes: Number(block.total_size ?? 0),
    durationMs: Number.isFinite(us) ? Math.round(us / 1000) : 0,
    speed: Number.parseFloat(block.speed ?? '0') || 0,
  }
}

async function runFfmpeg(args: string[], env: Record<string, string>): Promise<{ ok: boolean; error: string }> {
  const child = spawn({ cmd: args, stdout: 'ignore', stderr: 'pipe', stdin: 'ignore', env })
  let stderr = ''
  const decoder = new TextDecoder()
  for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
    stderr = (stderr + decoder.decode(chunk, { stream: true })).slice(-4000)
  }
  const code = await child.exited
  return {
    ok: code === 0,
    error: code === 0 ? '' : stderr.trim() || `ffmpeg exited with ${code}`,
  }
}

export function startRecorder(options: RecorderOptions): RecorderHandle {
  const ffmpegPath = options.ffmpegPath || 'ffmpeg'
  const sourcePath = `${options.outputBase}.ts`
  mkdirSync(dirname(sourcePath), { recursive: true })
  if (existsSync(sourcePath)) unlinkSync(sourcePath)

  const args = baseArgs(ffmpegPath)
  if (options.userAgent) args.push('-user_agent', options.userAgent)
  if (options.proxy) args.push('-http_proxy', options.proxy)
  args.push('-i', options.url)
  if (options.durationSec && options.durationSec > 0) args.push('-t', String(options.durationSec))
  if (options.audioOnly) args.push('-vn')
  args.push('-c', 'copy', '-f', 'mpegts', sourcePath)

  const env = {
    ...process.env,
  } as Record<string, string>
  if (options.proxy) {
    env.http_proxy = options.proxy
    env.https_proxy = options.proxy
    env.HTTP_PROXY = options.proxy
    env.HTTPS_PROXY = options.proxy
  }

  let child: Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    child = spawn({ cmd: args, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not start ffmpeg (${ffmpegPath}): ${message}`)
  }

  let stderr = ''
  let block: Record<string, string> = {}
  let lineBuffer = ''
  let lastProgress: RecorderProgress = { bytes: 0, durationMs: 0, speed: 0 }
  let stopRequested = false
  let settled = false

  const readStdout = async (): Promise<void> => {
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
      lineBuffer += decoder.decode(chunk, { stream: true })
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''
      for (const raw of lines) {
        if (!parseProgress(raw.trim(), block)) continue
        lastProgress = toProgress(block)
        block = {}
        options.onProgress?.(lastProgress)
      }
    }
  }

  const readStderr = async (): Promise<void> => {
    const decoder = new TextDecoder()
    for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
      stderr = (stderr + decoder.decode(chunk, { stream: true })).slice(-4000)
    }
  }

  const finalize = async (code: number | null): Promise<RecorderResult> => {
    const sourceExists = existsSync(sourcePath)
    const sourceBytes = sourceExists ? statSync(sourcePath).size : 0
    const durationMs = lastProgress.durationMs
    if (sourceBytes === 0) {
      if (sourceExists) unlinkSync(sourcePath)
      return {
        ok: false,
        file: null,
        sourceFile: null,
        bytes: 0,
        durationMs,
        code,
        error: stderr.trim() || (stopRequested ? 'Recording stopped before any data was written' : 'ffmpeg wrote no data'),
      }
    }

    const extension = options.audioOnly ? 'm4a' : 'mp4'
    const finalPath = `${options.outputBase}.${extension}`
    const containerArgs = options.audioOnly
      ? ['-vn', '-c', 'copy', '-f', 'ipod', finalPath]
      : ['-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', finalPath]

    if (options.bitrate) {
      const transcode = options.audioOnly
        ? ['-vn', '-c:a', 'aac', '-b:a', options.bitrate, '-f', 'ipod', finalPath]
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', options.bitrate, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', finalPath]
      const result = await runFfmpeg([ffmpegPath, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', sourcePath, ...transcode], env)
      if (!result.ok) stderr = `${stderr}\n${result.error}`.trim()
    } else {
      const result = await runFfmpeg([ffmpegPath, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', sourcePath, ...containerArgs], env)
      if (!result.ok) stderr = `${stderr}\n${result.error}`.trim()
    }

    const usable = existsSync(finalPath) && statSync(finalPath).size > 0
    if (!usable && options.bitrate) {
      // A failed re-encode still leaves the original capture usable.
      const remux = await runFfmpeg(
        [ffmpegPath, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', sourcePath, ...containerArgs],
        env,
      )
      if (!remux.ok) stderr = `${stderr}\n${remux.error}`.trim()
    }

    const finalExists = existsSync(finalPath) && statSync(finalPath).size > 0
    const file = finalExists ? finalPath : sourcePath
    if (finalExists && !options.keepSource) {
      try {
        unlinkSync(sourcePath)
      } catch {
        // The final file is already safe.
      }
    }

    const ok = (code === 0 || stopRequested) && (finalExists || sourceBytes > 0)
    return {
      ok,
      file,
      sourceFile: existsSync(sourcePath) ? sourcePath : null,
      bytes: existsSync(file) ? statSync(file).size : sourceBytes,
      durationMs,
      code,
      error: ok
        ? finalExists
          ? null
          : 'MP4 remux failed; kept the TS capture'
        : stderr.trim() || (finalExists ? 'ffmpeg stopped unexpectedly' : 'Could not finalize the recording'),
    }
  }

  const done: Promise<RecorderResult> = (async () => {
    await Promise.all([readStdout(), readStderr(), child.exited])
    const code = await child.exited
    if (settled) throw new Error('recorder settled twice')
    settled = true
    return finalize(code)
  })()

  const stop = async (): Promise<RecorderResult> => {
    if (settled) return done
    stopRequested = true
    try {
      child.kill('SIGINT')
    } catch {
      // Already gone.
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }, STOP_GRACE_MS)
    try {
      return await done
    } finally {
      clearTimeout(timer)
    }
  }

  return { sourcePath, stop, done }
}
