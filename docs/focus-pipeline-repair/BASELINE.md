# Baseline

Run: `.focus-data/rotoscope/60bd847f-d485-4c71-a27d-2b3336ed6d62` — 9 frames at 9 fps, crop 828×1472+0+160, 3 attempts on frame 1, 0/9 approved.

Reproduce (offline, no model call):

```bash
node --import ./scripts/ts-loader.mjs scripts/audit/baseline.ts --run .focus-data/rotoscope/60bd847f-d485-4c71-a27d-2b3336ed6d62 --out docs/focus-pipeline-repair/baseline/phase00.json
```

Phase 00 result: every check re-measured from the kept artifacts gives the recorded verdict and numbers exactly ([baseline/phase00.json](baseline/phase00.json)).

| Attempt | pose | scale | colour | proportions | alpha | review | Human (by eye) | 14-bone diagnostics (worst arm) |
|---|---|---|---|---|---|---|---|---|
| a1 | FAIL mirrored, 4 bones | ok | FAIL 92.9 % | FAIL forearm +45 % | FAIL edge | skipped | mirrored → reject | leftUpperArm 171° |
| a2 | ok, 4 bones | ok | FAIL 92.6 % | FAIL forearm +19 %, head −13 % | ok | skipped | correct pose and identity | rightUpperArm 14° |
| a3 | ok, 4 bones | ok | FAIL 93.8 % | FAIL forearm +60 % | ok | skipped | raised upper arm off | rightUpperArm 85° |

Baseline defects in the evaluator, against the human verdict:

- False reject: a2 (colour C3, proportions C6).
- False pass of a sub-check: a3 pose (C1: the arms were never measured).
- Review coverage: 0/3 attempts.

Each later phase re-runs this script and records the delta in its report.
