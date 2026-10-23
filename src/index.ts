import { resolve } from 'node:path'
import { Engine } from './engine'
import { createApp } from './server'
import { Store } from './store'
import { TikTokClient } from './tiktok/client'
import { MONITOR_MODES, type MonitorMode, type Variant, VARIANTS } from './core/types'

interface CliOptions {
  user?: string
  url?: string
  roomId?: string
  mode: MonitorMode
  intervalSec?: number
  durationSec?: number
  output?: string
  proxy?: string
  bitrate?: string
  ffmpegPath?: string
  cookies?: string
  dataDir?: string
  port: number
  host: string
  variant?: Variant
  help: boolean
  telegram: boolean
}

const isMode = (value: string): value is MonitorMode => MONITOR_MODES.some((mode) => mode === value)
const isVariant = (value: string): value is Variant => VARIANTS.some((variant) => variant === value)

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = { mode: 'manual', port: 3000, host: '127.0.0.1', help: false, telegram: false }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (!raw?.startsWith('-')) continue
    const trimmed = raw.replace(/^--?/, '')
    const [name, inline] = trimmed.split('=', 2)
    if (!name) continue

    const boolean = ['help', 'h', 'telegram', 'no-update-check', 'version'].includes(name)
    const value = inline ?? argv[index + 1]
    if (!boolean && (value === undefined || (inline === undefined && value.startsWith('-')))) {
      throw new Error(`Flag -${name} needs a value.`)
    }
    if (!boolean && inline === undefined) index += 1

    switch (name) {
      case 'help':
      case 'h':
      case 'version':
        options.help = true
        break
      case 'telegram':
        options.telegram = true
        break
      case 'no-update-check':
        break
      case 'user':
      case 'u':
        options.user = value
        break
      case 'url':
        options.url = value
        break
      case 'room_id':
      case 'roomId':
        options.roomId = value
        break
      case 'mode': {
        const modeValue = value ?? ''
        if (!isMode(modeValue)) throw new Error(`Unknown mode "${value}". Use manual, automatic, or followers.`)
        options.mode = modeValue
        break
      }
      case 'automatic_interval':
      case 'interval':
        options.intervalSec = Number(value)
        break
      case 'duration':
        options.durationSec = Number(value)
        break
      case 'output':
        options.output = value
        break
      case 'proxy':
        options.proxy = value
        break
      case 'bitrate':
        options.bitrate = value
        break
      case 'ffmpeg_path':
      case 'ffmpeg':
        options.ffmpegPath = value
        break
      case 'cookies':
        options.cookies = value
        break
      case 'data_dir':
        options.dataDir = value
        break
      case 'port':
        options.port = Number(value)
        break
      case 'host':
        options.host = value ?? options.host
        break
      case 'variant': {
        const variantValue = value ?? ''
        if (!isVariant(variantValue)) throw new Error(`Unknown variant "${value}". Use best, hd, sd, or audio.`)
        options.variant = variantValue
        break
      }
      default:
        console.warn(`tokweb: ignoring unknown flag -${name}`)
    }
  }

  if (!Number.isFinite(options.port) || options.port <= 0) options.port = 3000
  return options
}

const HELP = `tokweb — TikTok Live Recorder web UI

Usage: bun start [-user USER] [-url URL] [-room_id ID] [-mode MODE] [options]

Recording flags (upstream-compatible):
  -user <USER>              Username(s), comma separated
  -url <URL>                TikTok live URL
  -room_id <ID>             TikTok room id
  -mode <MODE>              manual (default), automatic, followers
  -automatic_interval <MIN> Poll interval in minutes for automatic mode
  -output <DIR>             Recordings directory (default ./recordings)
  -duration <SECONDS>       Max segment length
  -proxy <URL>              HTTP proxy for TikTok and ffmpeg
  -bitrate <BITRATE>        Re-encode bitrate, e.g. 1M or 1000k
  -ffmpeg_path <PATH>       ffmpeg binary (default ffmpeg)
  -cookies <FILE|HEADER>    cookies.json or raw Cookie header
  -variant <best|hd|sd|audio>

Web flags:
  -port <PORT>              Dashboard port (default 3000)
  -host <HOST>              Bind address (default 127.0.0.1)
  -data_dir <DIR>           State directory (default ./data)
  --help                    Show this help

Upstream's -telegram is not implemented; recordings stay on disk.`

function numberOrUndefined(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.round(value)))
}

async function readCookies(value: string | undefined): Promise<string> {
  if (!value) return ''
  const file = Bun.file(resolve(process.cwd(), value))
  if (await file.exists()) {
    try {
      return await file.text()
    } catch {
      // Treat it as a raw header below.
    }
  }
  return value
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }
  if (options.telegram) console.warn('tokweb: -telegram is not implemented; the recording stays on disk.')

  const store = new Store({ dataDir: options.dataDir, outputDir: options.output }).load()
  if (options.output) store.state.settings.outputDir = resolve(process.cwd(), options.output)
  if (options.ffmpegPath) store.state.settings.ffmpegPath = options.ffmpegPath
  if (options.proxy) store.state.settings.proxy = options.proxy
  if (options.bitrate) store.state.settings.bitrate = options.bitrate
  if (options.intervalSec) store.state.settings.defaultIntervalSec = Math.max(10, Math.round(options.intervalSec * 60))
  if (options.cookies) store.state.settings.cookies = await readCookies(options.cookies)
  store.save()

  const client = new TikTokClient({
    cookies: store.state.settings.cookies,
    proxy: store.state.settings.proxy,
    userAgent: store.state.settings.userAgent,
  })
  const engine = new Engine(store, client)
  engine.start()
  const app = createApp({ store, engine, client })

  try {
    app.listen({ port: options.port, hostname: options.host })
  } catch (error) {
    engine.stop().catch(() => undefined)
    throw new Error(`Could not listen on ${options.host}:${options.port}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const shownHost = options.host === '0.0.0.0' || options.host === '::' ? 'localhost' : options.host
  if (options.host !== '127.0.0.1' && options.host !== 'localhost' && options.host !== '::1') {
    console.warn('tokweb: dashboard is reachable beyond loopback and has no authentication. Use -host 127.0.0.1 unless you trust the network.')
  }
  console.log(`tokweb listening on http://${shownHost}:${options.port}`)
  console.log(`recordings: ${store.state.settings.outputDir}`)

  const seeds: Array<{ uniqueId?: string; url?: string; roomId?: string }> = []
  for (const user of options.user?.split(',').map((item) => item.trim()).filter(Boolean) ?? []) {
    seeds.push({ uniqueId: user })
  }
  if (options.url) seeds.push({ url: options.url })
  if (options.roomId) seeds.push({ roomId: options.roomId })

  for (const seed of seeds) {
    try {
      const monitor = await engine.addMonitor({
        ...seed,
        mode: options.mode,
        variant: options.variant,
        intervalSec: numberOrUndefined(options.intervalSec ? options.intervalSec * 60 : undefined, 10, 86_400),
        maxDurationSec: numberOrUndefined(options.durationSec, 5, 86_400) ?? null,
        autoRecord: options.mode !== 'manual',
      })
      console.log(`monitor ready: @${monitor.uniqueId ?? monitor.roomId} (${monitor.mode})`)
      if (options.mode === 'manual') {
        try {
          const recording = await engine.recordNow(monitor.id)
          console.log(`recording @${recording.uniqueId} -> ${recording.uniqueId}_${recording.roomId ?? 'room'}.mp4`)
        } catch (error) {
          console.warn(`not recording: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      console.error(`monitor failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    console.log('\nstopping recordings...')
    await engine.stop()
    await app.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error: unknown) => {
  console.error(`tokweb: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
