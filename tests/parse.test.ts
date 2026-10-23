import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractStreams, parseLivePage, parseLiveRoomResponse, pickStream } from '../src/tiktok/parse'
import { cookieHeader, normalizeInput, selectSource } from '../src/tiktok/client'
import { liveRoom } from './helpers'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8'))

describe('TikTok payload parsing', () => {
  test('parses a live API response and nested stream_data', () => {
    const room = parseLiveRoomResponse(fixture('live-api.json'), 'streamer')
    expect(room).not.toBeNull()
    expect(room?.status).toBe('live')
    expect(room?.uniqueId).toBe('streamer')
    expect(room?.roomId).toBe('7000000000000000001')
    expect(room?.title).toBe('Clean-room test stream')
    expect(room?.viewers).toBe(1234)
    expect(room?.streams.map((stream) => stream.url)).toContain('https://cdn.example.com/live/main.flv')
    expect(room?.streams.map((stream) => stream.url)).toContain('https://cdn.example.com/live/main.m3u8')
  })

  test('parses the real API shape with a string stream_data and liveRoomStats', () => {
    const room = parseLiveRoomResponse(fixture('live-api-real-shape.json'))
    expect(room?.status).toBe('live')
    expect(room?.uniqueId).toBe('aljazeera')
    expect(room?.viewers).toBe(11425)
    expect(room?.streams.some((stream) => stream.url === 'https://cdn.example.com/hd.flv')).toBe(true)
    expect(room?.streams.some((stream) => stream.quality === 'AUDIO')).toBe(true)
    expect(pickStream(room?.streams ?? [], 'audio')?.url).toBe('https://cdn.example.com/audio.flv')
  })

  test('parses an offline response without inventing streams', () => {
    const room = parseLiveRoomResponse(fixture('offline-api.json'))
    expect(room?.status).toBe('offline')
    expect(room?.streams.map((stream) => stream.url)).toContain('https://cdn.example.com/stale.flv')
    expect(room?.roomId).toBe('7000000000000000003')
  })

  test('parses the HTML universal-data fallback', () => {
    const html = readFileSync(join(import.meta.dir, 'fixtures', 'live-page.html'), 'utf8')
    const room = parseLivePage(html, 'pageuser')
    expect(room?.status).toBe('live')
    expect(room?.uniqueId).toBe('pageuser')
    expect(room?.streams.some((stream) => stream.url.endsWith('/page/full.flv'))).toBe(true)
  })

  test('extracts flv and hls maps with quality context', () => {
    const streams = extractStreams({
      flv_pull_url: { FULL_HD1: 'https://cdn.example.com/a.flv', SD1: 'https://cdn.example.com/b.flv' },
      hls_pull_url_map: { HD1: 'https://cdn.example.com/c.m3u8' },
    })
    expect(streams).toHaveLength(3)
    expect(pickStream(streams, 'best')?.quality).toBe('FULL_HD')
    expect(pickStream(streams, 'hd')?.url).toBe('https://cdn.example.com/c.m3u8')
    expect(pickStream(streams, 'sd')?.quality).toBe('SD')
  })

  test('normalizes user, URL, and room inputs', () => {
    expect(normalizeInput({ uniqueId: '@Some.User' })).toEqual({ uniqueId: 'Some.User', roomId: null })
    expect(normalizeInput({ url: 'https://www.tiktok.com/@some.user/live?lang=en' })).toEqual({
      uniqueId: 'some.user',
      roomId: null,
    })
    expect(normalizeInput({ url: 'https://www.tiktok.com/@x/live?room_id=7123456789012345678' })).toEqual({
      uniqueId: 'x',
      roomId: '7123456789012345678',
    })
    expect(normalizeInput({ roomId: '@no-at' })).toEqual({ uniqueId: 'no-at', roomId: null })
  })

  test('accepts upstream cookies.json, a map, or a raw header', () => {
    expect(cookieHeader('[{"name":"sessionid","value":"abc"},{"name":"ttwid","value":"xyz"}]')).toBe(
      'sessionid=abc; ttwid=xyz',
    )
    expect(cookieHeader('{"sessionid":"abc"}')).toBe('sessionid=abc')
    expect(cookieHeader('sessionid=abc; ttwid=xyz')).toBe('sessionid=abc; ttwid=xyz')
  })

  test('selects no source while offline', () => {
    expect(selectSource(liveRoom({ status: 'offline' }), 'best')).toBeNull()
    expect(selectSource(liveRoom(), 'best')?.quality).toBe('HD')
  })
})
