# ADR 0001: tokweb architecture

Status: accepted. Date: 2026-10-23.

## Context

Reimplement the behavior of a Python CLI TikTok recorder as a web-first tool. The core
risks are TikTok payload drift, ffmpeg lifecycle, and long-running monitor state. The
deliverable must be auditable and runnable on Bun with TypeScript 7 and Elysia.

## Decisions

1. **One Bun process, one journal owner.** `Store` owns `data/state.json`, writes it
   atomically (temp + rename), and reconciles interrupted jobs on boot. Monitors and
   recordings are plain arrays; the process is the only writer. SQLite was rejected:
   a few hundred rows do not justify a dependency or migration surface.
2. **Elysia + vanilla dashboard, no frontend build.** Elysia serves JSON, SSE, range
   media, and three static files. React/Vite would add a toolchain and duplicate state
   for a single-screen dashboard. SSE carries the full snapshot every 2 s; the API is
   usable without it.
3. **ffmpeg stream copy, remux on stop.** Record FLV with `-c copy`, then remux to MP4
   with `+faststart`. Re-encode only when a bitrate is configured. This keeps CPU low
   and produces browser-playable files. If remux fails, the FLV is retained.
4. **TikTok adapter behind `LiveResolver`.** `TikTokClient` handles URLs, room ids,
   cookies, `msToken`, `ttwid`, retries, and the HTML fallback. Engine and tests depend
   on the interface, so the recording pipeline is testable offline.
5. **Idempotent lifecycle.** Starting the same creator twice returns the existing
   recording; monitor add upserts by creator; boot repairs stale `recording` states;
   delete is index + file; reconciliation adopts files found on disk.
6. **Single-user localhost by default.** No auth. Binding beyond loopback prints an
   explicit warning because cookies and recordings are exposed.
7. **Observability is part of the product.** A bounded in-memory activity log, live
   snapshot, ffmpeg byte/duration progress, and an archive with range playback give the
   user direct evidence instead of a spinner.

## Consequences

- Two tokweb instances must not share a `data_dir`.
- State is capped at 500 recordings; older rows are dropped from the index, files stay.
- Followers mode inherits TikTok's private endpoint fragility.
- The dashboard has no offline persistence beyond the state snapshot; SSE reconnects
  automatically.
- Telegram upload is intentionally out of scope for this web build.

## Alternatives considered

- **yt-dlp subprocess**: hides the resolver and weakens the clean-room requirement.
- **Raw WebSocket room client**: more accurate live events, but a much larger protocol
  surface for no additional value to a recorder.
- **SQLite**: better concurrent writes, irrelevant for one process.
- **React**: better component reuse at 10x the UI size, worse time-to-first-run.
