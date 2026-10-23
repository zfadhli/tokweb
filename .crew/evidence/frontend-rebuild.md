# Frontend rebuild evidence

Branch `feat/htmx-frontend`. Predicate lives in `.crew/research/frontend-rebuild.md`.

## Gate

| Check | Result |
| --- | --- |
| `bun test` | 86 pass, 0 fail, 414 assertions, 12 files |
| `bun run typecheck` | clean |
| `bun run e2e` | E2E VERIFIED |
| Old SPA references | none outside tests (`EventSource` asserted absent) |

The e2e proof now covers the overview page, watch, recordings, admin, the vendored
htmx asset, the archive listing after a real ffmpeg capture, the player embed, a
form-encoded add-user round trip, range playback, the SSE endpoint, and the spawned
CLI server exiting on SIGINT.

## Screenshots

Ten shots, five pages at two viewports, in `ui-v2/`:

| Page | Desktop 1440x1000 | Mobile 390x1000 |
| --- | --- | --- |
| `/` | `final-home-1440.png` | `final-home-390.png` |
| `/watch` | `final-watch-1440.png` | `final-watch-390.png` |
| `/recordings` | `final-recordings-1440.png` | `final-recordings-390.png` |
| `/recordings/rec-pixel` | `final-player-1440.png` | `final-player-390.png` |
| `/admin` | `final-admin-1440.png` | `final-admin-390.png` |

Reproduce with:

```bash
bun scripts/fixture.ts -port 4100
bun scripts/screenshot.ts http://127.0.0.1:4100/watch /tmp/watch.png 1440 1000
```

## Vision findings that changed the code

Round 1 (home):

- Chart bars were invisible. Percentage heights did not resolve, so the server now
  sends pixel heights and zero days render a dim 4px stub.
- Four stats were not comparable (the output path sat in a number slot). The fourth
  stat became recorded time and the path moved to Admin.
- The hot cell used a red wash that read as an error. It is now a 2px inset rule.
- Muted text was lifted to `#8b94a2`.

Round 2 (watch):

- The data table squashed columns instead of scrolling on mobile. It has a 720px
  minimum inside the scroll wrapper.
- The active filter borrowed the button-primary style. It now uses a neutral
  selected state.
- The hand-drawn gradient chevron doubled. The native select arrow is back.
- The Actions column gained a visible header and the interval column aligns right.

Round 3 (recordings, admin, final pass):

- Admin storage clipped its Duration column in the narrow right rail. Storage moved
  to a full-width panel below the settings/system split, and the system rail sticks.
- The native checkbox rendered as a blue widget regardless of `accent-color`.
  Replaced with an opacity-0 input plus a `.check-box` sibling so the lime state
  renders in every engine.
- Home's capture grid left two orphan slots. The grid minimum is 160px and the
  preview caps at four, so one clean row.
- The watch table had no panel surface. It now shares the standard panel.
- Monitoring stats stay two-up at 390px; only sub-380 goes one column.

Colour claims were verified by pixel sampling, not by eye:

```text
checkbox   rgb(200,242,79)  = --accent
panel edge rgb(32,38,47)    = --line
```

## Harness limits

- Obscura renders no CSS gradients and reports some properties inaccurately
  (`background-image` is empty even when set). Gradients stay decorative; no
  affordance depends on one.
- Obscura mis-rasterizes some glyph spacing, which vision review reports as
  intra-word gaps. Text was verified in the DOM instead.
- No Chrome binary is installed, so screenshots come from one engine only.

## Deliberate omissions

- `/api/events` stays. It has no UI consumer now that pages poll fragments, but it
  is an existing API surface with a test and a use for scripts.
- Handlebars templates are compiled and cached per process. A template edit needs a
  server restart, and the fixture restarts for every screenshot batch.
- No sort control on the archive; rows stay newest-first, matching the journal.
