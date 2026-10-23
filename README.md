# tokweb

A web-first TikTok Live recorder. Clean-room implementation of the feature surface of
[Michele0303/tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder),
built on Bun, Elysia, TypeScript 7, and ffmpeg. No upstream source code is copied.

Add a creator to the watchlist, leave the server running, and tokweb records each live
session to a browser-playable MP4 once auto-record is enabled on that card. The dashboard splits the watchlist into offline, live,
and recording columns and shows the archive below.

## Requirements

- Bun 1.2+ (developed on 1.4.4)
- ffmpeg on `PATH` (or set `ffmpegPath` in Settings)
- Network access to TikTok; cookies are optional unless your region is blocked

## Quick start

```bash
bun install
bun start
# open http://127.0.0.1:3000
```

Add a creator from the CLI; the dashboard opens so you can enable auto-record:

```bash
bun start -user @creator
bun start -url https://www.tiktok.com/@creator/live -automatic_interval 2
```

Both forms still start the dashboard. `Ctrl-C` stops ffmpeg cleanly and finalizes the file.

## How capture works

1. Resolve the creator through TikTok's room API, with an HTML fallback when the API is
   blocked.
2. Pick the requested feed: `best`, `hd`, `sd`, or `audio`.
3. Spawn ffmpeg with `-c copy` into an intermediate TS. No quality loss, low CPU.
4. On stop, duration cap, or stream end, remux to MP4 (`+faststart`) and delete the TS.
   Set a bitrate in Settings to re-encode instead. If remux fails, the TS is kept.
5. Update the journal, reconcile interrupted jobs on boot, and serve the archive with
   byte-range playback. Monitors resuming from the journal stagger their first live
   check by 1.5s each, capped at 45s per sweep, so a restart does not fire every
   TikTok lookup at once.

## Monitoring

Every monitor polls TikTok on an interval (3 min by default, set in Settings) and records
a live room only when auto-record is enabled on its card. New monitors start with
auto-record off. Multiple monitors are added from the username field; quality, interval,
and max segment come from Settings, with per-monitor overrides available through the API.

## CLI

Upstream-compatible flags use a single dash. The dashboard always starts.

| Flag | Description |
| --- | --- |
| `-user <USER>` | Username(s), comma separated |
| `-url <URL>` | TikTok live URL |
| `-room_id <ID>` | TikTok room id |
| `-automatic_interval <MIN>` | Default poll interval in minutes |
| `-output <DIR>` | Recordings directory (default `./recordings`) |
| `-duration <SECONDS>` | Max segment length |
| `-proxy <URL>` | HTTP proxy for TikTok and ffmpeg |
| `-bitrate <BITRATE>` | Re-encode bitrate, e.g. `1M` or `1000k` |
| `-ffmpeg_path <PATH>` | ffmpeg binary |
| `-cookies <FILE\|HEADER>` | `cookies.json` or a raw Cookie header |
| `-variant <VARIANT>` | `best`, `hd`, `sd`, `audio` |
| `-port <PORT>` | Dashboard port (default `3000`) |
| `-host <HOST>` | Bind address (default `127.0.0.1`) |
| `-data_dir <DIR>` | State directory (default `./data`) |
| `--help` | Usage |

`-telegram` and `-no-update-check` are accepted with a warning/ignored. Telegram upload
is not implemented.

## Cookies

Paste either format into Settings or pass `-cookies`:

```json
[{ "name": "sessionid", "value": "..." }, { "name": "ttwid", "value": "..." }]
```

```text
sessionid=...; ttwid=...
```

The client also fetches a `ttwid` automatically. Cookies usually help in blocked
regions. Cookies remain in `data/state.json` in plain
text on this machine. Do not expose the dashboard to an untrusted network: it has no
authentication.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Full snapshot: monitors, recordings, settings, system |
| `GET` | `/api/events` | SSE snapshot stream |
| `POST` | `/api/probe` | Resolve `{ uniqueId \| url \| roomId }` without saving |
| `GET/POST` | `/api/monitors` | List / add (upserts by creator) |
| `PATCH/DELETE` | `/api/monitors/:id` | Update / remove |
| `POST` | `/api/monitors/:id/check` | Refresh room state |
| `POST` | `/api/monitors/:id/record` | Record now |
| `POST` | `/api/monitors/:id/stop` | Stop the active recording |
| `GET` | `/api/recordings` | Archive index |
| `GET` | `/api/recordings/:id/file` | MP4 with Range support |
| `GET` | `/api/recordings/:id/download` | Attachment |
| `DELETE` | `/api/recordings/:id` | Delete file and index entry |
| `GET/PUT` | `/api/settings` | Read (cookies masked) / update |

## Layout

```text
src/
  core/types.ts        domain types and unions
  core/naming.ts       output name template and parser
  tiktok/parse.ts      boundary parser for API + HTML payloads
  tiktok/client.ts     resolver, cookies, retries, following list
  recorder/ffmpeg.ts   spawn, progress, stop, remux/transcode
  store.ts             atomic JSON journal, boot reconciliation
  engine.ts            monitor loops, recording lifecycle
  server.ts            Elysia routes, SSE, range responses
  index.ts             CLI + server bootstrap
public/                dashboard (vanilla JS, no build step)
scripts/               live probe, e2e proof, screenshot harness
tests/                 bun:test units, fixtures, fake resolver/recorder
```

## Development

```bash
bun test                 # unit/integration tests, no network
bun run typecheck        # TypeScript 7 native tsc
bun run e2e              # real HTTP + engine + ffmpeg + disk proof
bun run probe @creator --record 8
bun run screenshot http://127.0.0.1:3000 /tmp/tokweb.png 1440 900
```

`bun run e2e` fakes only the TikTok resolver: a generated FLV stands in for a live feed,
then the script verifies the monitor, recording, MP4, range endpoint, snapshot masking,
deletion, and a spawned CLI server.

## Known limits

- TikTok aggressively rate-limits room lookups from some IPs (`HTTP 403` / `429`). The
  resolver retries, obtains a `ttwid`, and falls back to the live page; if all paths are
  blocked, add cookies or use a proxy.
- Monitors poll sequentially; large watchlists spread first checks on boot but recurring
  ticks are independent timers.
- Streams that are HEVC or otherwise not browser-compatible may need a bitrate set so the
  final file is re-encoded.
- The journal is a single JSON file owned by one process. Do not run two tokweb
  instances against the same `data_dir`.
- Telegram upload is out of scope for this web build.

## Legal

Record only streams you have permission to record. Respect TikTok's terms, creator
rights, and local law. The software is provided as-is under the MIT license; the author
is not affiliated with TikTok or with the upstream project.
