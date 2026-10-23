# Single automatic mode

Branch: `refactor/single-mode`

## Removed

- `manual` and `followers` modes, `MonitorMode` / `MONITOR_MODES`, `Monitor.mode`,
  `MonitorInput.mode`, PATCH `mode`, `-mode` CLI flag, `LiveResolver.following`,
  `TikTokClient.following` / `secUid` / `collectFollowing`, `FollowingUser`,
  `EngineOptions.followLimit`, `tickFollowers`.
- Add form options other than the username field: mode, quality, poll interval, max
  segment. New monitors take `defaultVariant`, `defaultIntervalSec`,
  `defaultMaxDurationSec` from Settings.

## Migration

`Store.loadedMonitors` deletes the retired `mode` key and warns how many stored monitors
now poll automatically. Previously manual monitors start polling with `autoRecord`
unchanged (off by default from the previous change). Previously followers monitors poll
their own account instead of the following list.

## Settings

New `Settings.defaultMaxDurationSec` (seconds, `0` = unlimited), clamped 0..86400 in the
API, editable as minutes in Settings. Engine uses it when `addMonitor` receives no
`maxDurationSec`.

## Verified

- `bun test` 41 pass / 145 assertions.
- `bun run typecheck` clean.
- `bun run e2e` E2E VERIFIED (dashboard, monitor create, capture, range, delete, CLI boot
  and SIGINT).
- Source sweep: only remaining `mode` references are the store migration delete and the
  legacy-fixture test that proves it.
