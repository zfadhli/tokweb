import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { TikTokClient, type FetchLike } from '../src/tiktok/client'

const liveApi = await Bun.file(join(import.meta.dir, 'fixtures', 'live-api.json')).text()
const livePage = await Bun.file(join(import.meta.dir, 'fixtures', 'live-page.html')).text()

function recorder() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return new Response('<html></html>', { status: 200 })
  }
  return { calls, fetchImpl }
}

describe('TikTok client', () => {
  test('fetches ttwid once, retries a 429, and sends the cookie', async () => {
    let apiCalls = 0
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = new TikTokClient({
      retries: 2,
      fetch: async (url, init) => {
        calls.push({ url, init })
        if (url === 'https://www.tiktok.com/') {
          return new Response('<html></html>', {
            status: 200,
            headers: { 'set-cookie': 'ttwid=cookie-value; Path=/' },
          })
        }
        apiCalls += 1
        if (apiCalls === 1) return new Response('', { status: 429 })
        return new Response(liveApi, { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    const room = await client.resolve({ uniqueId: 'streamer' })
    expect(room.status).toBe('live')
    expect(apiCalls).toBe(2)
    expect(calls.filter((call) => call.url === 'https://www.tiktok.com/')).toHaveLength(1)
    const apiCall = calls.find((call) => call.url.includes('api-live'))
    const headers = new Headers(apiCall?.init?.headers)
    expect(headers.get('cookie')).toContain('ttwid=cookie-value')
    expect(apiCall?.url).toContain('msToken=')
  })

  test('falls back to the HTML page when the JSON API is blocked', async () => {
    const client = new TikTokClient({
      retries: 1,
      fetch: async (url) => {
        if (url === 'https://www.tiktok.com/') return new Response('<html></html>', { status: 200 })
        if (url.includes('api-live')) return new Response('', { status: 403 })
        if (url.includes('/@pageuser/live')) return new Response(livePage, { status: 200 })
        return new Response('', { status: 404 })
      },
    })
    const room = await client.resolve({ url: 'https://www.tiktok.com/@pageuser/live' })
    expect(room.status).toBe('live')
    expect(room.uniqueId).toBe('pageuser')
    expect(room.streams.length).toBeGreaterThan(0)
  })

  test('passes a room id to the API when no username is available', async () => {
    let requested = ''
    const client = new TikTokClient({
      retries: 1,
      fetch: async (url) => {
        if (url === 'https://www.tiktok.com/') return new Response('<html></html>', { status: 200 })
        requested = url
        return new Response(liveApi, { status: 200 })
      },
    })
    const room = await client.resolve({ roomId: '7000000000000000001' })
    expect(room.roomId).toBe('7000000000000000001')
    expect(requested).toContain('roomId=7000000000000000001')
  })

  test('reports a blocked lookup instead of hanging', async () => {
    const client = new TikTokClient({
      retries: 1,
      fetch: async (url) => {
        if (url === 'https://www.tiktok.com/') return new Response('', { status: 403 })
        return new Response('', { status: 403 })
      },
    })
    expect(client.resolve({ uniqueId: 'blocked' })).rejects.toThrow('403')
  })
})
