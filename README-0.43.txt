PRIDA 0.43.0 — LOCOMOTION AND SKIN REPAIR

Fixed the actual 0.42 animation failure: serialized FBX clips had no UUID. Three.js
AnimationClip.parse copied undefined into every clip UUID, causing AnimationMixer
clipAction() to reuse Idle for all imported names. The runtime now assigns unique IDs
on registration, and the new export also supplies stable IDs. Tests verify separate
AnimationAction instances AND real foot movement across repeated loops.

New motion source: Quaternius Universal Animation Library Standard, CC0-1.0.
Fifteen distinct source clips include walk, jog, sprint, crouch, jump-start/air/land,
hit reaction, sit, interact, pickup and swim. The library contains 36 retargeted clips
per character when the retained user-uploaded combat clips and mirrored right strafe
are included. Crouch and swim are available clips, not new player input mechanics.

Automatic idle looking-around and planted-foot idle turn animation are disabled.
Player-controlled aiming and deliberately triggered cosmetic emotes remain.
Direction selection survives repeated 30 Hz snapshots on 120/144 Hz screens.
Walking/running legs have their own playback clock while the upper body aims,
fires or reloads. Bare-handed movement no longer gets its arm swing overwritten
by the stationary combat guard. Sprint is distinct from jog, not a faster copy.

MODEL: the 0.41 assets were simplified static STL surfaces with generated skinning,
not an authored animated character. This update repairs helmet, torso and limb
weights without changing geometry, proportions, colours, normals or triangle count.
Original discarded STL detail and texture maps have NOT been reconstructed.
public/PRIDA-0.43-model-report.json records the hashes and weight changes.

INSTALL THE COMPACT GITHUB UPDATE:
Extract the update ZIP. Upload all five files with their paths intact:
package.json, package-lock.json, prida-update.mjs, README-0.43.txt,
tests/build-entrypoints.test.mjs. Uploading the ZIP itself does not install it.
The pre-Docker build-entrypoints test is mandatory. npm ci followed by npm run build
extracts and validates the cumulative patch, including 0.42 FPV/aircraft/suit work.

FULL SOURCE:
npm ci
npm run test:release
npm run dev
Open /scripts/review-043.html on the development server for an interactive WebGL
motion/rig inspector using the actual runtime animation selector and mixer.
The page is a development diagnostic, not a new in-game screen.

Source: https://quaternius.com/packs/universalanimationlibrary.html
Author's download: https://opengameart.org/content/universal-animation-library
