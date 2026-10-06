# PRIDA 0.32 — Rocket system

Cumulative from the verified 0.31.2 upload package, SHA eb5ddb648e10bc9fb1e28656238752403d2cadf8.

## Controls and game tuning

Hold Q (or ROCKET on touch) for sequential unguided launches. LMB cannon and RMB machine gun are unchanged. Q retains weapon quick-swap when on foot.

Aircraft: 8 STRIKE rockets, alternating under-wing stations, 0.28 s firing interval; no in-flight reload. Base service replenishes them.

Tanks: 4 SIEGE launcher tubes, 8 reserve rockets. 0.65 s firing interval and a 5 s automatic magazine reload. Stations turn and elevate with the turret aim. Service replenishes magazine and reserve.

Rockets are unguided, accelerate during flight, and expire after a bounded lifetime. Their balance values are fictional game values. There is no target lock or homing in this release.

R at a service pad still repairs, refuels and replenishes the cannon and machine gun; it now also replenishes rockets. Rocket ammunition, cooldowns, rack reload and projectile states are authoritative and carried in existing snapshots for both server and peer-hosted matches.

## Effects and performance

Locally generated finned rockets, tank launcher tubes, aircraft rails, visible loaded stations, exhaust flame, smoke trails and a separate launch sound. No downloads, no new external models, no changes to existing assets. New graphics attach to the normalized vehicle root, so they also work with external base meshes.

Shared geometry/materials are reference-counted. No new Rapier body or point light is created per rocket. Cannon shells and rockets share a hard 64-projectile ceiling; a single vehicle has at most eight airborne rockets. When the pool is full, a new shot is declined without deleting an old projectile or using ammunition. Rocket smoke has a per-frame emission budget and is culled at distance. Geometry, camera, terrain, world size, car contacts and flight movement from 0.31.2 are otherwise unchanged.

## Installation

Upload package.json and prida-update.mjs together to the repository root, not src/. ZIP files must be unpacked before uploading. The cumulative installer validates the baseline and stages changes before running inherited tests, added rocket tests, actual installed engine integration tests and Vite. Do not disable the gates to force a deployment. The active footer after a successful build is 0.32 · ROCKET SYSTEM.

## Verification scope

Local test reports accompanying this release distinguish pure module tests and isolated engine tests from full-game testing. The test integration-rockets-032.test.mjs is included as a mandatory install-time test against the real installed Arena, Rapier, Three.js and network serializer. A desktop/mobile multiplayer game session has not been certified by the archive itself.
