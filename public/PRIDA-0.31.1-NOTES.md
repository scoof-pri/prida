# PRIDA 0.31.1 — runway placement fix

Cumulative update for main@5580f96c6887124f51785b3862af564254d62377.
The four-sector map, vehicle physics, gun/camera controls and all deployment gates are retained.

## Confirmed failure
Render deployment dep-dav71ek1nsns738v444g failed on 2026-10-01 at 14:40 UTC.
Six integration cases passed; the seventh failed with `fighter must take off`.
The east sandbag row in expansion-world.js was centred on `base.x + 53`,
which is exactly the runway centre. Two sandbags intersected fighter-1's
hull at spawn. Rapier therefore blocked the takeoff roll as designed.
The later detailed sandbag stack also occupied the runway, behind that spawn.

## Changes
- Move both east sandbag groups onto the apron, outside the runway edge.
- Keep every sandbag, its health, surface and native destruction record.
- Add 14 layout checks for district/city seeds, both detail settings and all four tiles.
- Retain the original real-Arena takeoff assertions (health, altitude, distance, occupancy).
- Include vehicle coordinates and speed in a future takeoff-test failure.
- Summarise the first failing test in the installer's final error instead of only the gate name.

## Local verification and limits
151 pure-JavaScript regression/layout tests pass.
An isolated reproduction uses the real VehicleSystem movement code and the official
Rapier 0.19.3 build, with the real base collision geometry on a flat triangle grid.
Before relocation: the aircraft stays blocked. After relocation at 60 Hz for four
seconds: speed 38.0 m/s, altitude 19.01 m, travel 72.66 m, health 780/780.
The local harness replaces unrelated gameplay dependencies; it is not a full Arena,
WebGL session or a Vite build. Render still uses the project's locked Rapier 0.19.0.
No dependency upgrade is included. All original native integration and Vite checks
remain mandatory at deployment. This package has not been deployed by the assistant.
