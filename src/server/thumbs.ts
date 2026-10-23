import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerDeps } from './deps'
import { isActiveRecording } from './view'

const inflight = new Map<string, Promise<string | null>>()
const missing = new Set<string>()

function thumbPath(deps: ServerDeps, id: string): string {
  return join(deps.store.dataDir, 'thumbs', `${id}.jpg`)
}

/** First video frame of a finished recording, rendered once and cached on disk. */
export async function ensureThumb(deps: ServerDeps, id: string): Promise<string | null> {
  const recording = deps.store.recording(id)
  if (!recording || isActiveRecording(recording)) return null
  const source = deps.store.recordingPath(recording)
  if (!source) return null

  const target = thumbPath(deps, id)
  if (await Bun.file(target).exists()) return target
  if (missing.has(target)) return null

  const pending = inflight.get(target)
  if (pending) return pending

  const job = (async (): Promise<string | null> => {
    try {
      mkdirSync(join(deps.store.dataDir, 'thumbs'), { recursive: true })
      const child = Bun.spawn(
        [
          deps.store.state.settings.ffmpegPath,
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          '1',
          '-i',
          source,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:-2',
          '-q:v',
          '4',
          target,
        ],
        { stdout: 'ignore', stderr: 'ignore' },
      )
      if ((await child.exited) !== 0) {
        missing.add(target)
        return null
      }
      if (!(await Bun.file(target).exists())) {
        missing.add(target)
        return null
      }
      return target
    } catch {
      missing.add(target)
      return null
    } finally {
      inflight.delete(target)
    }
  })()

  inflight.set(target, job)
  return job
}

export async function removeThumb(deps: ServerDeps, id: string): Promise<void> {
  const path = thumbPath(deps, id)
  missing.delete(path)
  await Bun.file(path)
    .delete()
    .catch(() => {})
}
