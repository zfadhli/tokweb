import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FollowingUser, LiveRoom, ResolveInput } from '../src/core/types'
import type { LiveResolver } from '../src/tiktok/client'
import type { RecorderFactory, RecorderHandle, RecorderOptions, RecorderResult } from '../src/recorder/ffmpeg'

export function tempDir(prefix = 'tokweb-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export class FakeResolver implements LiveResolver {
  room: LiveRoom
  followingUsers: FollowingUser[] = []
  calls = 0
  error: Error | null = null

  constructor(room: LiveRoom) {
    this.room = room
  }

  async resolve(_input: ResolveInput): Promise<LiveRoom> {
    this.calls += 1
    if (this.error) throw this.error
    return this.room
  }

  async following(_uniqueId: string): Promise<FollowingUser[]> {
    if (this.error) throw this.error
    return this.followingUsers
  }
}

export interface FakeRecorderControl {
  options: RecorderOptions
  finish(result?: Partial<RecorderResult>): void
  stopped: boolean
}

export function fakeRecorderFactory(): { factory: RecorderFactory; handles: FakeRecorderControl[] } {
  const handles: FakeRecorderControl[] = []
  const factory: RecorderFactory = (options) => {
    let settle: (result: RecorderResult) => void = () => undefined
    const done = new Promise<RecorderResult>((resolve) => {
      settle = resolve
    })
    let finished = false
    const finish = (result: Partial<RecorderResult> = {}): void => {
      if (finished) return
      finished = true
      settle({
        ok: true,
        file: `${options.outputBase}.mp4`,
        sourceFile: `${options.outputBase}.ts`,
        bytes: 2048,
        durationMs: 5_000,
        code: 0,
        error: null,
        ...result,
      })
    }
    const control: FakeRecorderControl = {
      options,
      finish,
      stopped: false,
    }
    handles.push(control)
    return {
      sourcePath: `${options.outputBase}.ts`,
      stop: async () => {
        control.stopped = true
        finish()
        return done
      },
      done,
    } satisfies RecorderHandle
  }
  return { factory, handles }
}

export function liveRoom(overrides: Partial<LiveRoom> = {}): LiveRoom {
  return {
    status: 'live',
    uniqueId: 'streamer',
    nickname: 'Test Streamer',
    avatarUrl: null,
    roomId: '7000000000000000001',
    title: 'Clean-room test stream',
    viewers: 1234,
    streams: [
      { url: 'https://cdn.example.com/live/hd.flv', format: 'flv', quality: 'HD' },
      { url: 'https://cdn.example.com/live/sd.flv', format: 'flv', quality: 'SD' },
    ],
    ...overrides,
  }
}
