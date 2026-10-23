# TikTok live resolution: observed behavior

Date: 2026-10-23. Network: residential IP, region MY. All findings below were produced
by direct requests, not inferred from the upstream source.

## Primary endpoint

```text
GET https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=<user>&msToken=<107 chars>
Headers: browser User-Agent, Referer: https://www.tiktok.com/
```

- `msToken` is a random 107-character URL-safe string generated per request.
- A `ttwid` cookie is fetched from `https://www.tiktok.com/` when possible and sent with
  later requests. The API also works without it.
- Responses: `200` JSON, `403` or `429` with an empty body when the IP is rate-limited.
  Repeated requests from one IP trigger this within a few dozen calls. Backoff and
  cookies help; a proxy is the reliable fix.
- `statusCode: 0` on success. `.data.user.status` and `.data.liveRoom.status` are `2`
  when live, `4` when offline.
- Offline rooms still return a stale `title` and `pull_data` options; do not infer live
  state from the presence of `pull_data`.

## Real live payload shape

Captured from `aljazeera` while status 2:

```text
data.user:      uniqueId, nickname, avatarThumb, roomId, status
data.liveRoom:  status, title, liveRoomStats { enterCount, userCount }, streamData
data.liveRoom.streamData.pull_data:
  options:     { default_quality, qualities[] }
  stream_data: JSON string
```

Decoded `stream_data`:

```text
common: { session_id, room_id, max_push_resolution, default_audio_track }
data:   { hd: { main: { flv, hls, cmaf, dash, lls, ... }, backup: {...} },
          ao: { main: { flv, hls, ... } } }
```

- `hd.main.flv` is a signed CDN URL that expires in ~1 hour.
- `ao` is audio-only. Our parser maps it to `AUDIO`.
- Some rooms expose `origin`/`uhd`, `sd`, and `ld` instead of `hd`.
- The webcast-style shape `stream_url.flv_pull_url` is also handled by the same
  recursive extractor.

## Verified live run

```text
bun scripts/probe-live.ts aljazeera
  status: live, roomId: 7698480612664183559, streams: HD flv + HD hls + AUDIO
bun scripts/probe-live.ts aljazeera --record 8
  ok: true, durationMs: 8057, bytes: 1701652
ffprobe: format mp4, duration 8.084 s, size 1701652
```

## HTML fallback

`https://www.tiktok.com/@<user>/live` returns `__UNIVERSAL_DATA_FOR_REHYDRATION__` and
sometimes `SIGI_STATE`. Offline pages did not contain a live room. Our fallback walks
the parsed scripts for an object with `roomId` and stream data, then falls back to a
room-id regex plus URL harvesting. It is a safety net, not the primary path.

## Fixtures

- `tests/fixtures/live-api.json` – synthetic nested `pull_data.stream_data`.
- `tests/fixtures/live-api-real-shape.json` – real `hd` + `ao` shape and
  `liveRoomStats.userCount`, with URLs replaced by example.com.
- `tests/fixtures/live-page.html` – universal-data HTML fallback.
- `tests/fixtures/offline-api.json` – status 4 with stale metadata.
