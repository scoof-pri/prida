PRIDA 0.41.0 — BASE DRONES / CUSTOM CHARACTERS

Cumulative update over the supplied PRIDA 0.40 snapshot.
Upload every extracted file/folder from the update ZIP to the repository root.
Includes package.json, prida-update.mjs, and tests/build-entrypoints.test.mjs.
The tests folder fixes the obsolete pre-Docker CI check; do not omit it.
Do not upload this ZIP to CrazyGames; it is a source installer, not a portal client.

Features:
- Five finite FPV pickups per military base, twenty total on the four-sector city.
  Use E to collect, N to control/return, WASD and Space/C to pilot; LMB detonates.
- KITE WINGS removed from runtime loot, gear and rendering. Legacy helper code remains
  only for backward-compatible state cleanup and historical tests.
- Automatic glider deployment at a height threshold removed. The separately equipped
  manual glider still requires held ascent input; no automatic deployment occurs.
- AEGIS: hold Space for thrust. At rest Space climbs; moving with WASD follows camera
  elevation. Space+C descends. Release Space to stop thrust. Shift boosts. Energy finite.
- Uploaded tactical soldier replaces standard actor shapes, including lobby and bots.
  Uploaded Iron Man geometry replaces the entire equipped AEGIS suit. Skeleton instances
  are independent; mesh buffers are shared. New authored locomotion/flight poses.
- Third-person palm/boot jets and first-person gauntlets use the local suit geometry.

Assets are derived from the user's STL uploads, simplified and given game-authored
skinning, vertex colors and PBR materials. The STLs contain no texture maps or animations.
No claim of CC0 or Marvel/Epic/Meshy commercial redistribution clearance is made for
these user assets. Original source hashes are in public/PRIDA-0.41-model-report.json.
The runtime downloads no STL or remote avatar model.

Validation:
This installer retains every 0.40 release gate and adds actual 0.41 asset/Arena tests.
Previous KITE runtime assertions were changed to enforce intentional removal.
The separate broad historical test suite has pre-existing failures in the 0.40 snapshot
(hard-coded old weapons/bosses/landmark expectations among them); it is not all green.
Do not describe the release-gate result as passing every historical test.
Browser WebGL and real FPS have not been verified in this environment.
Detailed executed results accompany the release as PRIDA-0.41-checks.txt.
