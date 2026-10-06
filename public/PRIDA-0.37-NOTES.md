# PRIDA 0.37 — Stage A / Activity and Armour

Cumulative over 0.36. Upload package.json and prida-update.mjs together at repository root.
This is Stage A of four. FPV drones, building, vehicle ramp/drift physics, new terrain and
lab/suit upgrades belong to later stages; this release does not silently claim them.

- Renderer loads nearby sectors intersecting the camera frustum (plus a small safety halo).
  Existing building occlusion still applies inside sectors. Unseen resident geometry is hidden,
  retained for five seconds, then unloaded. This is conservative sector culling, not pixel-exact visibility.
- Native collision always follows ALL live actors, not one person's camera. Recently active shapes
  and terrain remain resident for five simulation seconds. Global damage and world timers continue.
- Distant unobserved bots reuse decisions at 2Hz after five seconds; movement and physics continue.
  Nearby fights, airborne actors, projectiles and active boss attacks remain responsive.
- HYDRA: 6 ready + 24 reserve rockets, 0.09 s minimum interval, 3.2 s magazine reload.
  Q starts a six-missile salvo, holding repeats magazines. 12 in flight per HYDRA; 64 global.
  Gun and MG ammo are finite. Only the explicit solo Debug infinite option bypasses ammunition.
- Armour uses five separate fictional arcade plates: front, left, right, rear, top.
  Kinetic damage leaks 25% and blasts leak 45% while a plate has strength. Exhausted plates
  no longer absorb. Collision/environment damage bypasses armour. A service pad restores plates.
- Aircraft STRIKE rocket damage: 145 -> 260, blast radius: 4.7 -> 6.0 game metres; 8 finite missiles.
- Exterior third-person battle bus camera; on-foot preference restored after leaving bus.
- Developer Solo Debug chooses the Big City map, retaining zero bots and no storm.
- Vehicles, doors and lifts use per-connection persistent deltas. Unchanged state is not retransmitted.
  First connection/round has a full baseline; failed sends do not commit it; ordered per-ID versions
  support late reliable packets. All players/damage stay authoritative. Big City state rate is 15Hz,
  simulation remains 30Hz. Duel settings remain unchanged. No promise of physical RTT or device FPS.

Tests in this package distinguish isolated logic, real native library fixtures and full-tree gates.
The installer will not commit source edits until its mandatory checks and Vite builds succeed.
