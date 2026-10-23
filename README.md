# tokweb

A web-first TikTok Live recorder. Clean-room implementation of the feature surface of
[Michele0303/tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder),
built on Bun, Elysia, TypeScript 7, and ffmpeg. No upstream source code is copied.

Add a creator to the watchlist, leave the server running, and tokweb captures each live
session to a browser-playable MP4. The dashboard shows room state, recording progress,
ffmpeg activity, and the archive.

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

Record a creator from the CLI immediately:

```bash
bun start -user @creator -mode manual
bun start -url https://www.tiktok.com/@creator/live -mode automatic -automatic_interval 2
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
   byte-range playback.

## Recording modes

| Mode | Behavior |
| --- | --- |
| `manual` | Check or record on demand. The CLI records once at startup. |
| `automatic` | Polls the room on an interval and records whenever it goes live. Default for new dashboard monitors. |
| `followers` | Polls the following list of an account and records followed creators who are live. Requires authenticated cookies; experimental. |

## CLI

Upstream-compatible flags use a single dash. The dashboard always starts.

| Flag | Description |
| --- | --- |
| `-user <USER>` | Username(s), comma separated |
| `-url <URL>` | TikTok live URL |
| `-room_id <ID>` | TikTok room id |
| `-mode <MODE>` | `manual`, `automatic`, `followers` |
| `-automatic_interval <MIN>` | Poll interval in minutes |
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

The client also fetches a `ttwid` automatically. `sessionid` is required for followers
mode and usually helps in blocked regions. Cookies remain in `data/state.json` in plain
text on this machine. Do not expose the dashboard to an untrusted network: it has no
authentication.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Full snapshot: monitors, recordings, settings, activity |
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
  engine.ts            monitor loops, recording lifecycle, activity log
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
- Followers mode depends on private TikTok endpoints whose shape changes; treat it as
  experimental.
- Streams that are HEVC or otherwise not browser-compatible may need a bitrate set so the
  final file is re-encoded.
- The journal is a single JSON file owned by one process. Do not run two tokweb
  instances against the same `data_dir`.
- Telegram upload is out of scope for this web build.

## Legal

Record only streams you have permission to record. Respect TikTok's terms, creator
rights, and local law. The software is provided as-is under the MIT license; the author
is not affiliated with TikTok or with the upstream project.
