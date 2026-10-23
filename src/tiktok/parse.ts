import type {
  LiveRoom,
  StreamFormat,
  StreamSource,
  Variant,
} from '../core/types'

type Json = Record<string, unknown>

const rec = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const int = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

const QUALITY_RANK: Record<string, number> = {
  FULL_HD: 5,
  HD: 4,
  SD: 3,
  LD: 2,
  AUDIO: 1,
  UNKNOWN: 0,
}

function qualityOf(key: string): string | null {
  const k = key.toUpperCase()
  if (/FULL_?HD|ORIGIN|UHD|1080/.test(k)) return 'FULL_HD'
  if (/^HD|720/.test(k)) return 'HD'
  if (/^SD|540/.test(k)) return 'SD'
  if (/^LD|360/.test(k)) return 'LD'
  if (/^AO$|AUDIO|M4A/.test(k)) return 'AUDIO'
  return null
}

function formatOf(url: string, hint?: string): StreamFormat | null {
  const path = url.split('?')[0]?.toLowerCase() ?? ''
  if (path.endsWith('.m3u8')) return 'hls'
  if (path.endsWith('.m4a') || path.endsWith('.mp3')) return 'm4a'
  if (path.endsWith('.flv')) return 'flv'
  if (hint?.includes('hls')) return 'hls'
  if (hint?.includes('audio')) return 'm4a'
  return null
}

function normalizeUrl(raw: string): string | null {
  const url = raw
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim()
  if (url.startsWith('//')) return `https:${url}`
  if (/^https?:\/\//.test(url)) return url
  return null
}

/**
 * TikTok returns stream data in several nested encodings across web/mobile
 * endpoints. Decode strings and harvest anything that looks like a media URL.
 */
export function extractStreams(input: unknown): StreamSource[] {
  const found = new Map<string, StreamSource>()

  const visit = (node: unknown, quality: string, hint: string, depth: number): void => {
    if (depth > 10) return
    if (typeof node === 'string') {
      const asUrl = normalizeUrl(node)
      if (asUrl) {
        const format = formatOf(asUrl, hint)
        if (format && !found.has(asUrl)) {
          found.set(asUrl, { url: asUrl, format, quality })
        }
        return
      }
      const trimmed = node.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          visit(JSON.parse(trimmed), quality, hint, depth + 1)
        } catch {
          // Not JSON, nothing to harvest.
        }
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, quality, hint, depth + 1)
      return
    }
    if (typeof node !== 'object' || node === null) return

    for (const [key, value] of Object.entries(node as Json)) {
      const nextQuality = qualityOf(key) ?? quality
      const nextHint = /flv|hls|audio|m3u8|m4a/i.test(key) ? key.toLowerCase() : hint
      visit(value, nextQuality, nextHint, depth + 1)
    }
  }

  visit(input, 'UNKNOWN', '', 0)
  return [...found.values()].sort((a, b) => {
    const byQuality = (QUALITY_RANK[b.quality] ?? 0) - (QUALITY_RANK[a.quality] ?? 0)
    if (byQuality !== 0) return byQuality
    return a.format === 'flv' ? -1 : b.format === 'flv' ? 1 : 0
  })
}

/** Pick the feed that best matches the requested quality. */
export function pickStream(streams: StreamSource[], variant: Variant): StreamSource | null {
  const order: Record<Variant, string[]> = {
    best: ['FULL_HD', 'HD', 'SD', 'LD', 'AUDIO'],
    hd: ['HD', 'FULL_HD', 'SD', 'LD', 'AUDIO'],
    sd: ['SD', 'LD', 'HD', 'FULL_HD', 'AUDIO'],
    audio: ['AUDIO'],
  }
  const wanted = order[variant]
  for (const quality of wanted) {
    const match = streams.find((s) => s.quality === quality && s.format !== 'm4a')
    if (match) return match
    if (variant === 'audio') {
      const audio = streams.find((s) => s.format === 'm4a' || s.quality === 'AUDIO')
      if (audio) return audio
    }
  }
  return streams[0] ?? null
}

function findLiveRoom(node: unknown, depth = 0): Json | null {
  if (depth > 12 || typeof node !== 'object' || node === null) return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findLiveRoom(item, depth + 1)
      if (hit) return hit
    }
    return null
  }
  const obj = node as Json
  const hasRoom = text(obj.roomId) !== '' || text(obj.id) !== ''
  const hasStreams = obj.streamData !== undefined || obj.stream_url !== undefined
  const looksLive = hasRoom && (hasStreams || obj.title !== undefined || obj.status !== undefined)
  if (looksLive) return obj
  for (const value of Object.values(obj)) {
    const hit = findLiveRoom(value, depth + 1)
    if (hit) return hit
  }
  return null
}

function roomFromObject(live: Json, user: Json, fallbackUser: string): LiveRoom {
  const owner = rec(live.owner)
  const stats = rec(live.stats)
  const roomStats = rec(live.liveRoomStats)
  const uniqueId =
    text(owner.uniqueId) ||
    text(owner.unique_id) ||
    text(user.uniqueId) ||
    fallbackUser
  const nickname =
    text(owner.nickname) ||
    text(user.nickname) ||
    uniqueId
  const roomId = text(live.roomId) || text(live.id) || text(user.roomId) || null
  const pull = rec(live.streamData).pull_data ?? live.streamData ?? live.stream_url
  const streams = extractStreams(pull)
  // Offline rooms can still carry stale signed URLs, so status wins whenever present.
  const statuses = [live.status, user.status].filter(
    (value): value is number | boolean => typeof value === 'number' || typeof value === 'boolean',
  )
  const isLive = statuses.length > 0 ? statuses.some((value) => value === 2 || value === true) : streams.length > 0

  return {
    status: isLive ? 'live' : 'offline',
    uniqueId,
    nickname,
    avatarUrl: text(owner.avatarThumb) || text(user.avatarThumb) || null,
    roomId,
    title: text(live.title),
    viewers:
      int(stats.total_user) ||
      int(stats.user_count) ||
      int(roomStats.total_user) ||
      int(roomStats.user_count) ||
      int(roomStats.userCount) ||
      int(roomStats.enterCount),
    streams,
  }
}

/** Parse `GET /api-live/user/room/` JSON. Returns null on a non-room payload. */
export function parseLiveRoomResponse(raw: unknown, fallbackUser = ''): LiveRoom | null {
  const root = rec(raw)
  const data = rec(root.data)
  const live = rec(data.liveRoom)
  const user = rec(data.user)
  if (Object.keys(live).length === 0 && Object.keys(user).length === 0) return null
  return roomFromObject(live, user, fallbackUser)
}

const JSON_SCRIPT =
  /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi
const UNIVERSAL_SCRIPT =
  /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i
const SIGI_SCRIPT = /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i

/** Parse a live page when the JSON API is blocked. */
export function parseLivePage(html: string, fallbackUser = ''): LiveRoom | null {
  const blocks: string[] = []
  const universal = html.match(UNIVERSAL_SCRIPT)
  if (universal?.[1]) blocks.push(universal[1])
  const sigi = html.match(SIGI_SCRIPT)
  if (sigi?.[1]) blocks.push(sigi[1])
  for (const match of html.matchAll(JSON_SCRIPT)) {
    if (match[1]) blocks.push(match[1])
  }

  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block)
    } catch {
      continue
    }
    const live = findLiveRoom(parsed)
    if (live) {
      const room = roomFromObject(live, {}, fallbackUser)
      if (room.roomId) return room
    }
  }

  // Last resort: the page embeds escaped JSON in inline scripts.
  const roomMatch = html.match(/\\?"roomId\\?":\\?"(\d{10,})\\?"/)
  if (!roomMatch?.[1]) return null
  const streams = extractStreams(html)
  return {
    status: streams.length > 0 ? 'live' : 'offline',
    uniqueId: fallbackUser,
    nickname: fallbackUser,
    avatarUrl: null,
    roomId: roomMatch[1],
    title: '',
    viewers: 0,
    streams,
  }
}
