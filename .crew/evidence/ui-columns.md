# Watchlist columns + console removal

Layout change, verified by measurement and rendered pixels.

## Removed

- `public/index.html`: `<aside class="activity-panel">` (Console / Activity) deleted,
  section numbering renumbered (Archive 03, Configuration 04).
- `public/app.js`: `renderActivity()`, `fmtClock()`, `#activity-count` write.
- `public/style.css`: `.activity-*`, `.pulse-dot`.
- `src/engine.ts`: `ActivityEvent`, `events`, `activity` getter, `log()`, 6 call sites,
  dead `formatBytes` export. `src/server.ts`: `activity` key in the snapshot.

## Columns

Watchlist panel now spans full width with `.monitor-columns` = 3 equal columns
(Offline / Live / Recording). Bucket rule in `public/app.js`:

    recordingId || state === 'recording' -> recording
    live                                 -> live
    otherwise                            -> offline

At <=1080px columns stack, dividers become horizontal rules.

## Bug found and fixed during review

`.status.recording` matched the archive row rule `.recording { display: grid;
grid-template-columns: 66px 1fr 92px 210px }`, which won on source order and blew the
status label up to a full-width row (card ~55px taller than its neighbours). Fix:
scoped archive rules to `.library .recording` (and the responsive variants).
Root cause was an unscoped generic class name, not the new markup.

## Measured

State rail colours sampled from the rendered PNG (ffmpeg crop -> raw rgb24):

| card | expected | pixel |
| --- | --- | --- |
| standby | `--line` #262b33 | `262b33` |
| error | amber | `f0b45a` |
| live | `--accent` #d6ff3f | `d6ff3f` |
| recording | `--red` | `ff6b5f` |

Rails sit 9px inside each card, 1px column dividers remain separate. Note: a first
vision pass reported the error rail as grey and a rail/divider collision; pixel sampling
refuted the colour claim and the 9px inset fixed the collision.

Column heights measured: all three `.monitor-col` boxes 337px in the fixture, card
heights equal at ~170px per card after the `.recording` scoping fix.

## Gates

- `bun test` 31 pass / 125 assertions.
- `bun run typecheck` clean.
- `bun run e2e` E2E VERIFIED.
- Vision review of 1440x1800 and 900x1800 renders: no overflow, no clipping, no
  stacking defect remaining.

Fixture note: screenshots came from a throwaway stub server (`/tmp/tokweb-ui/stub.ts`)
that serves `public/` with a fabricated snapshot, because the engine clears a
`recordingId` it did not start at boot.
