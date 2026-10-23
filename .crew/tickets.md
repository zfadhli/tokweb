# tokweb tickets

Definition of done: `bun test` green, `tsc --noEmit` clean under TypeScript 7, dashboard
renders at 1440 and 390 widths, monitor records a fake-live fixture end-to-end through
real ffmpeg, real TikTok resolver returns a playable stream URL, and a real 6 s live
capture is playable.

## Phase A: Frame

- [x] Read Principles section and applied leaves. Evidence: task log; principle choices
  named in `.crew/ledger.tsv`.
- [x] Frame predicate, scope, rigor, blockers. Evidence: turn framing; ledger row F1.

## Phase B: Design

- [x] ADR 0001: Bun/Elysia/vanilla UI/ffmpeg/JSON journal. Evidence:
  `.crew/adr/0001-architecture.md`.
- [x] Research TikTok payloads and rate limits. Evidence:
  `.crew/research/tiktok-live-api.md`.
- [x] Build harness before features: `bun test`, fake resolver, fake recorder, E2E
  script. Evidence: `tests/helpers.ts`, `scripts/e2e.ts`.

## Phase C/D: Units

- [x] Scaffold + TypeScript 7 config. Evidence: `tsconfig.json`, `package.json`.
- [x] Domain types + naming. Evidence: `src/core/types.ts`, `src/core/naming.ts`,
  `tests/store.test.ts`.
- [x] TikTok parser + client + fixtures. Evidence: `tests/parse.test.ts`,
  `tests/client.test.ts`, `.crew/evidence/tests.txt`.
- [x] Journal store + restart reconciliation. Evidence: `tests/store.test.ts`.
- [x] ffmpeg recorder with progress, stop, duration, remux. Evidence:
  `tests/recorder.test.ts`.
- [x] Monitor engine: manual, automatic, followers, dedupe. Evidence:
  `tests/engine.test.ts`.
- [x] Elysia API + SSE + range media. Evidence: `tests/server.test.ts`.
- [x] Dashboard UI + responsive layout. Evidence: `.crew/evidence/desktop.png`,
  `.crew/evidence/mobile.png`, visual review (lens verdict: SHIP after 5 passes).
- [x] CLI parity + README. Evidence: `src/index.ts`, `README.md`,
  `.crew/evidence/e2e.txt`.
- [x] E2E proof. Evidence: `.crew/evidence/e2e.txt`, `.crew/evidence/ffprobe.txt`.
- [x] Real live capture. Evidence: `.crew/evidence/probe-live.txt`.

## Phase E: Final gates

- [x] `bun test` (31 pass). Evidence: `.crew/evidence/tests.txt`.
- [x] `tsc --noEmit`. Evidence: `.crew/evidence/tsc.txt`.
- [x] `bun scripts/e2e.ts` → E2E VERIFIED. Evidence: `.crew/evidence/e2e.txt`.
- [x] Screenshot desktop/mobile. Evidence: `.crew/evidence/desktop.png`,
  `.crew/evidence/mobile.png`.

## Open / intentionally deferred

- Followers mode relies on an authenticated, private TikTok endpoint; unit-tested with a
  fake resolver, not verified against a logged-in account.
- Telegram upload is not implemented (`-telegram` warns).
- Real capture was verified with one creator (`aljazeera`, 6 s). Long-session behavior
  beyond the fixture duration is inferred from ffmpeg's stream-copy lifecycle.
- TikTok can rate-limit the resolver per IP; cookies/proxy are the documented remedy.

## Phase F: crash-safe intermediate

- [x] Capture to `.ts` (`-f mpegts`) instead of FLV, remux to MP4 as before; setting and
  recorder fields renamed `keepSource` / `sourcePath` / `sourceFile`.
- [x] Crash proof: `kill -9` mid-capture leaves a `.ts` that remuxes to MP4 with exit 0 and
  no warnings (3.99 s of a 20 s source). Evidence: `.crew/evidence/ts-crash.txt`.

## Phase G: watchlist columns

- [x] Console / Activity panel deleted from the dashboard; snapshot no longer carries
  `activity`, engine activity feed removed with it.
- [x] Watchlist split into Offline / Live / Recording columns, stacking at <=1080px.
- [x] Fixed the `.status.recording` vs archive `.recording` class collision found in
  vision review. Evidence: `.crew/evidence/ui-columns.md`,
  `.crew/evidence/ui-columns.png`, `.crew/evidence/ui-columns-narrow.png`.

## Phase H: staggered resume

- [x] First live check of each monitor is spread by `bootStaggerMs` (default 1.5 s,
  0 disables), capped at 45 s per sweep, so a restart or a `-user a,b,c` seed does not
  fire every TikTok lookup in the same second. Monotonic slot counter, so a monitor
  added mid-sweep cannot reuse a slot that already fired.
- [x] Tests cover boot sweep, post-start seeding (CLI path), disabling, and a reschedule
  after the first check firing immediately. Evidence: `.crew/evidence/boot-stagger.md`.
- [ ] Followers mode still resolves up to `followLimit` (10) followed creators back to
  back inside one tick with no gap. Not covered by this change.

## Phase I: single automatic mode

- [x] Removed `manual` and `followers` modes end to end: types, engine tick/check/start,
  PATCH/API input, CLI `-mode`, resolver `following()`, followers tests.
- [x] Add form reduced to the username field; quality, poll, and max segment come from
  Settings (`defaultVariant`, `defaultIntervalSec`, new `defaultMaxDurationSec`).
- [x] Stored monitors keep working: `mode` is stripped on load; legacy manual/followers
  monitors now poll automatically.
- [x] Followers IP-burst item from Phase H is obsolete with followers mode removed.
- [x] Verification: 41 tests, typecheck clean, E2E VERIFIED. Evidence:
  `.crew/evidence/single-mode.md`.
