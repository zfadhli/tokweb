/**
 * Live probe against TikTok. This is the only script that needs the public
 * internet; unit tests run offline.
 *
 *   bun scripts/probe-live.ts @creator
 *   bun scripts/probe-live.ts https://www.tiktok.com/@creator/live --record 8
 */
import { join } from 'node:path'
import { TikTokClient, selectSource } from '../src/tiktok/client'
import { startRecorder } from '../src/recorder/ffmpeg'
import type { Variant } from '../src/core/types'

const args = process.argv.slice(2)
const target = args.find((arg) => !arg.startsWith('-'))
const recordIndex = args.indexOf('--record')
const recordSec = recordIndex >= 0 ? Number(args[recordIndex + 1] ?? 5) : 0
const variantIndex = args.indexOf('--variant')
const variant = (variantIndex >= 0 ? args[variantIndex + 1] : 'best') as Variant

if (!target) {
  console.error('usage: bun scripts/probe-live.ts @creator [--record 8] [--variant best]')
  process.exit(2)
}

const client = new TikTokClient({ retries: 3 })
console.log(`resolving ${target}…`)
try {
  const room = await client.resolve(target.includes('://') ? { url: target } : { uniqueId: target.replace(/^@/, '') })
  const source = selectSource(room, variant)
  console.log(
    JSON.stringify(
      {
        status: room.status,
        uniqueId: room.uniqueId,
        roomId: room.roomId,
        title: room.title,
        viewers: room.viewers,
        streams: room.streams.map((item) => ({ quality: item.quality, format: item.format })),
        selected: source ? { quality: source.quality, format: source.format, host: new URL(source.url).host } : null,
      },
      null,
      2,
    ),
  )
  if (!source) {
    console.log('RESOLVER VERIFIED (offline or no feed)')
    process.exit(0)
  }
  console.log('RESOLVER VERIFIED')
  if (recordSec > 0) {
    const out = join('/tmp', 'tokweb-probe', `probe_${Date.now()}`)
    console.log(`recording ${recordSec}s to ${out}.ts…`)
    const handle = startRecorder({
      url: source.url,
      outputBase: out,
      durationSec: recordSec,
      keepSource: true,
      onProgress: (progress) => {
        process.stdout.write(`\r${(progress.bytes / 1024 / 1024).toFixed(2)} MB`)
      },
    })
    const result = await handle.done
    process.stdout.write('\n')
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exit(1)
    console.log('RECORD VERIFIED')
  }
} catch (error) {
  console.error(`PROBE FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
