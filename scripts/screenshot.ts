/**
 * Viewport screenshot through the obscura CDP server. Kept in-repo so the
 * visual check is re-runnable: `bun scripts/screenshot.ts <url> <out.png> [w] [h]`.
 */
import { spawn } from 'bun'

const [url, out, widthArg, heightArg] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: bun scripts/screenshot.ts <url> <out.png> [width] [height]')
  process.exit(2)
}
const width = Number(widthArg) || 1440
const height = Number(heightArg) || 900
const port = Number(process.env.OBSCURA_PORT) || 9444

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function obscuraUp(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

async function ensureObscura(): Promise<ReturnType<typeof spawn> | null> {
  if (await obscuraUp()) return null
  const child = spawn({
    cmd: ['obscura', 'serve', '--port', String(port), '--allow-private-network', '--quiet'],
    stdout: 'ignore',
    stderr: 'ignore',
  })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(200)
    if (await obscuraUp()) return child
  }
  throw new Error('obscura did not start')
}

class Cdp {
  private readonly socket: WebSocket
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly events = new Map<string, Array<() => void>>()

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      let message: {
        id?: number
        method?: string
        result?: unknown
        error?: { message: string }
      }
      try {
        message = JSON.parse(String(event.data)) as typeof message
      } catch {
        return
      }
      if (message.id !== undefined) {
        const handler = this.pending.get(message.id)
        if (!handler) return
        this.pending.delete(message.id)
        if (message.error) handler.reject(new Error(message.error.message))
        else handler.resolve(message.result)
        return
      }
      if (message.method) {
        for (const listener of this.events.get(message.method) ?? []) listener()
      }
    })
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = this.nextId
    this.nextId += 1
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  waitFor(method: string, timeoutMs = 20_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs)
      const listeners = this.events.get(method) ?? []
      listeners.push(() => {
        clearTimeout(timer)
        resolve()
      })
      this.events.set(method, listeners)
    })
  }

  close(): void {
    this.socket.close()
  }
}

async function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => resolve(socket), { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
}

const daemon = await ensureObscura()
try {
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
    webSocketDebuggerUrl: string
  }
  const browser = new Cdp(await openSocket(version.webSocketDebuggerUrl))
  const created = await browser.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
  const attached = await browser.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: created.targetId,
    flatten: true,
  })
  const session = attached.sessionId

  await browser.send('Page.enable', {}, session)
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: width < 600 },
    session,
  )
  await browser.send('Page.navigate', { url }, session)
  await sleep(2_800)
  try {
    await browser.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, session)
  } catch {
    // The screenshot below is the real check.
  }

  const shot = await browser.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, session)
  await Bun.write(out, Buffer.from(shot.data, 'base64'))
  console.log(`screenshot ${width}x${height} -> ${out}`)

  browser.close()
} finally {
  if (daemon) daemon.kill('SIGTERM')
}
