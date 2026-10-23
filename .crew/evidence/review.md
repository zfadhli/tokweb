# Visual review trail

Tool: lens agent (vision), screenshots rendered by `scripts/screenshot.ts` through
obscura CDP at 1440 wide and 390 wide.

## Round 1 — FIX FIRST

- Event count badge vs footer mismatch.
- Error sub-line contrast below 4.5:1.
- Off-state AUTO toggle invisible.
- State differentiation weak.
- Mobile CONNECTED label clipped to a bare square.
- Mobile stat padding/wrapping uneven.

## Round 2 — partial

- Error title amber fix confirmed.
- AUTO off state still too dark (knob ~2:1).
- Mobile OUTPUT path wrapped; stat cells ragged.

## Round 3 — PASS on targeted items

- AUTO switches now show a distinct track + light knob in both states.
- Mobile OUTPUT truncates on one line; 2x2 stats aligned.
- No new clipping.

## Round 4 — archive and mobile

- Archive duration column still shifted per row; rows without a file showed only an ×.

## Round 5 — final

- Dark body background verified with pixel probes after separating `background-color`
  from `background-image` (the screenshot engine rejected the multi-layer shorthand).
- Archive durations align at one right edge; NO FILE affordance present; delete column
  consistent.
- Mobile watchlist + archive stack cleanly, actions reachable, no horizontal scroll.
- Error message wraps to two lines intentionally.

Verdict: **SHIP**. Minor non-blocking note: duration formatting mixes `32:30` and
`1:00:00`; both are readable and consistent with their magnitudes.
