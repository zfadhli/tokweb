# Frontend rebuild: server-rendered pages with htmx 4 and Alpine

User brief: new branch, Handlebars + htmx 4 + Alpine, admin-dashboard redesign,
home with statistics and archive, watch page with add form and users column,
recordings page listing all archives.

## Predicate (falsifiable)

Done when all of these hold on branch `feat/htmx-frontend`:

1. `bun test` green, including new tests for view formatting, every page route,
   every HTML mutation, and XSS escaping.
2. `bun run typecheck` clean.
3. `bun run e2e` green, extended to assert all five pages render and one HTML
   add-user round trip works through the real engine.
4. `GET /`, `/watch`, `/recordings`, `/recordings/:id`, `/admin` return 200 HTML
   with the shared shell and an active nav item.
5. Deleted: `public/index.html`, the old `public/app.js` DOM renderer, and the old
   stylesheet. No client-side JSON-to-DOM renderer remains. `EventSource` appears
   nowhere in the UI.
6. Screenshots at 1440 and 390 px of all five pages pass vision review with no
   blocker, and the reviewed defects are fixed and re-shot.
7. htmx and Alpine are served from their npm packages, not vendored copies.

## Rigor

High. The page surface is user-facing, the stack changes wholesale, and the old
client disappears in the same branch. Every unit ends in a test or a screenshot.
Work lands as ordered commits so a reviewer can replay red to green.

## Decisions

- **Server rendering owns formatting.** `src/server/view.ts` is pure and tested.
  Templates print preformatted strings. One source of truth for bytes, duration,
  dates, status labels.
- **Pages are routes, not an SPA.** Full page load per nav (fast on localhost,
  deep links, back button), fragments for partial refresh. No client router.
- **Live updates are htmx polling, not SSE.** The UI polls fragments every 3 s.
  `/api/events` stays for scripts and the e2e proof, with no UI consumer.
- **Mutations return 204 + `HX-Trigger`.** One refresh event redraws a fragment;
  no duplicated render paths. Add-user returns the panel so an error message can
  swap in place.
- **Handlebars layout partial.** `renderPage(name, chrome, data)` renders the page
  then wraps it in `layout.hbs`. Template compile cache per process; no build step.
- **Vendor by resolution.** `/vendor/:file` maps a fixed allowlist to package
  specifiers via `Bun.resolveSync`. Version lives in package.json; no copied JS
  in `public/`.
- **CSS is one file with shared components.** Page slices compose existing classes.
  Only the skeleton owner edits existing rules.
- **No screenshots of gradients.** The obscura engine does not render CSS
  gradients and mis-rasterizes some text. Essential affordances (chart bars) use
  solid fills and pixel heights. Decorative gradients are not verified visually.
- **Fixture server for review.** `scripts/fixture.ts` seeds monitors, archive
  rows, and one live capture through the real engine with a fake resolver and fake
  recorder. No network, no polling. Screenshots are deterministic.

## Route map

| Method | Path | Response |
| --- | --- | --- |
| GET | `/` | home page: stats, 7-day volume, latest captures, watchlist |
| GET | `/watch` | add form + users table |
| GET | `/partials/users` | users panel fragment |
| GET | `/recordings` | archive table, `?q=` and `?state=` filters |
| GET | `/partials/recordings` | archive table fragment |
| GET | `/recordings/:id` | player page, 404 when unknown |
| GET | `/admin` | settings form + system panel |
| POST | `/watch` | add user, re-render panel |
| POST | `/watch/:id/check` | 204 + HX-Trigger |
| POST | `/watch/:id/record` | 204 + HX-Trigger |
| POST | `/watch/:id/stop` | 204 + HX-Trigger |
| PATCH | `/watch/:id` | auto-record / quality, 204 + HX-Trigger |
| DELETE | `/watch/:id` | 204 + HX-Trigger |
| DELETE | `/recordings/:id` | redirect to `/recordings` |
| PUT | `/admin/settings` | settings panel + toast |
| GET | `/vendor/:file` | allowlisted package asset |

JSON API under `/api/*` is unchanged. It is the contract for CLI, tests, e2e, and
scripts.

## Data shape

```ts
interface PageChrome {
  active: 'home' | 'watch' | 'recordings' | 'admin'
  title: string
  live: number
  recording: number
  bun: string
}
```

Each page module builds its own view rows from `store.state` plus `engine.activeCount`.
Shared field names: `id`, `handle`, `initial`, `title`, `status`, `statusKind`,
`variant`, `autoRecord`, `bytes`/`bytesLabel`, `durationLabel`, `dateLabel`,
`recording`, `live`, `playable`, `downloadUrl`, `fileUrl`.

Templates never compute. Helpers are limited to `eq`.

## Seams and decomposition

- Blocking first: renderer, layout, design system, home, tests, fixture harness.
  Everything else composes them.
- Independent slices after that: watch, recordings + player, admin. Each owns its
  route module, template, partials, test file, and one mount line. Serialized in
  the same worktree because all three touch `src/server.ts` mounts and
  `public/app.css`; parallel workers would collide on shared writes.
- Shared mutable state: `store.state` and `engine.active` are mutated only through
  existing engine methods. HTML handlers are thin adapters, no new mutation path.
- Smallest safe decomposition: one slice per page, each with its own gate. A
  single owner per slice beats fan-out here because the surfaces are small and
  the integration points are shared.

## Risks

- htmx 4 has explicit-only attribute inheritance and renamed attributes versus 2.x.
  Markup must put target/swap on the request element. Verified by reading the
  packaged htmx 4 skill docs.
- Alpine inside swapped fragments needs the `alpine-compat` extension. Loaded
  before Alpine, enabled with `hx-ext`.
- Template caching hides edits until the process restarts. Fixture restarts after
  template changes.
- Obscura cannot verify gradients and may OCR-misread glyph spacing. Trust computed
  measurements for geometry, eyes for composition.

## Verification

- `bun test`, `bun run typecheck`, `bun run e2e`.
- `bun scripts/fixture.ts` + `bun scripts/screenshot.ts` for the five pages at two
  viewports.
- Vision review on the PNGs, defects fixed and re-shot before the trail is closed.
