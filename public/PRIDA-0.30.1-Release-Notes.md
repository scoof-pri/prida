# PRIDA 0.30.1 — vehicle fixes

Cumulative installer for scoof-pri/prida, checked against the 0.30 installer
in main commit 4c4940578afc84f4d6abcdfab65dfbbab7b19361. This is not a set of
old source files copied from 0.27.

## Changes

- The walking camera and walking FOV no longer execute while mounted. The
  vehicle camera owns its follow-distance history; it never lerps from a
  position overwritten by the walking camera. The camera ignores its own
  chassis collider and uses near-plane corner probes against other geometry.
- Tank gun aiming has separate sanitized yaw/elevation inputs. The displayed
  turret uses the same interpolated chassis orientation as its model. External
  tank meshes are accepted only when they have a linked turret and elevation
  hierarchy; otherwise the fully rigged built-in tank is used and labelled.
- Vehicle collision filtering compares Rapier collider handles instead of
  JavaScript wrapper identity when excluding the vehicle's own collider.
- A moving vehicle updates spatial-grid entries in place, without splicing the
  whole map obstacle array. Identical client states do not reindex colliders.
- Resting vehicles sleep. Vehicle and door transform changes share the same
  pre-pedestrian physics refresh. The code does not disable world collisions.
- Every street-car obstacle gets a driveable spawn, without the former 28-item
  limit or model-name allowlist. Native parked car meshes remain in the existing
  instanced scenery. Separate animated models are created only for activated,
  nearby vehicles; distant animated models are released.
- Snapshots are absolute sparse vehicle states on top of the deterministic
  spawn catalogue. Untouched parked cars are not re-sent each tick. Activated
  or damaged cars continue to be included, supporting dropped packets and late
  joins. Cars do not disappear when nobody is inside them.
- Car collision/model dimensions preserve the parked car's original dimensions
  rather than forcing vans/trucks/buses into a sedan-sized envelope.
- Generated vehicle rigid meshes are merged where animation permits; parked
  tracks do not re-upload matrices. Distant vehicles skip animation and shadows.
  Engine audio automation and unchanged HUD labels no longer update every frame.
- For the Big Royale/city map, Fort North is placed beside the northern CITY CORE
  edge, not beyond the wilderness boundary. The gate is 18 world units from that
  edge and connected by a road. The base/runway footprint is reserved before
  wilderness generation. The small-map base and the two villas retain their
  previous placement.

## Tank ramming and flight controls

- Tanks damage destructible walls, doors, trees, rocks, base fences and other
  props through the native destruction functions. Only objects in the swept
  footprint are hit; there is a bounded contact budget and a short per-object
  cooldown. Supporting floors and the map/terrain boundaries are not deleted.
- Destroyed vehicles can be crushed by a tank. Both their visual model and
  collision obstacle are removed; absolute vehicle snapshots carry this state
  to late joiners and after a lost packet. Fresh map state restores the spawn.
- Tanks can clear collapse rubble. The authoritative cleared-building list
  removes the same rubble collider and visible rubble mesh on clients.
- Friendly-occupied vehicle protection remains enabled. A tank is not invincible;
  heavy targets can require repeated contact and explosions can damage it.
- Site-owned villa props now lose physical collision along with their owner,
  not just visibility.
- Aircraft: HOLD W to accelerate, then look up with the mouse to take off.
  Mouse-look controls desired pitch and heading; A/D adds steering. Space/C and
  touch climb/descend buttons remain optional assists. S reduces throttle.
  Pitch/turn rates, stall and fuel limits remain part of the arcade flight model.
- The old per-frame camera-angle reset has been removed. The initial aircraft
  heading is copied only once on boarding. Positive takeoff movement no longer
  immediately triggers the landing test while the wheels are near the runway.

## Installation

Upload package.json and prida-update.mjs together to the repository ROOT.
Do not upload these two files into src/. The archive must be extracted first.
The regular build hook runs the installer; a service restart without a new
build does not install changed source code.

The installer retains the complete 0.29/0.30 integration and checks source
hashes/anchors and existing exports before changes. No new third-party package
versions or asset providers are introduced. Existing local vehicle GLBs are
reused when available. Binary models are not included in this ZIP.

## Validation and limits

Locally executed: 114 isolated logic/geometry/performance-counter tests and 13
installer/rollback tests; JavaScript syntax validation. The performance harness
uses explicit query/physics doubles, not the actual renderer or Rapier. In its
500-parked-car case, 120 unchanged packets produce zero repeated grid rewrites;
one moved car updates exactly one entry. This is not a measured FPS claim.

The HUD alone was checked in Chromium for car/tank/plane states at 1280x720,
390x844 and 844x390 (9 viewport/state checks), using explicit mock vehicle states.
These are UI tests, not gameplay captures.

The local environment cannot resolve npm/CDN hosts, so the full game, actual
Rapier integration, imported GLBs and browser WebGL gameplay were NOT run here.
Before committing sources, the installer runs the project's real Rapier and
Three.js integration gates (camera, turret, all-car city,
actual wall ramming and W+mouse takeoff) and a Vite module/link build in staging. Failure stops installation without
committing patched source files. These gates do not replace a visual playtest or
an online session on the user's hardware. No universal frame-rate guarantee is
made.

Scope: fixes for 0.30 transport. This is not an implementation of additional
weapons, new tank variants, or tunnels. Existing weapon types remain. Ramming and mouse-directed flight are included;
map boundaries and supporting terrain are deliberately not made pass-through.
