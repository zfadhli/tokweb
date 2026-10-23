# Boot stagger first-check measurement

Delays assigned as slot * step, step = min(bootStaggerMs, 45000 / (total - 1)). Monotonic slot counter per sweep.

## Command

```text
cd /home/envs4/workspaces/tokweb && bun test tests/engine.test.ts
```

## Verbatim output

```text
(pass) Engine > automatic mode records when live and finalizes the job [62.53ms]
(pass) Engine > recordNow is idempotent while a recording is active [1.97ms]
(pass) Engine > refuses to record an offline creator [1.72ms]
(pass) Engine > manual monitors do not auto-record [51.45ms]
(pass) Engine > stopRecording marks the job cancelled and keeps the monitor [1.83ms]
(pass) Engine > adding the same creator updates the existing monitor [0.41ms]
boot stagger gaps ms: 80, 80 | span ms: 160
(pass) Engine boot stagger > spreads the first checks of a boot sweep [322.57ms]
stagger off span ms: 0
(pass) Engine boot stagger > bootStaggerMs 0 disables the spread [60.91ms]
seed stagger gaps ms: 79, 80
(pass) Engine boot stagger > staggers monitors seeded after boot, the CLI path [325.71ms]
(pass) Engine boot stagger > a monitor rescheduled after its first check fires immediately [354.07ms]
(pass) Engine followers mode > starts recordings for live followed creators [81.09ms]
 11 pass
 0 fail
 28 expect() calls
```
