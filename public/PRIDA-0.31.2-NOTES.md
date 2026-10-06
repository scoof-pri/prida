# PRIDA 0.31.2 — car contacts, camera and driving-time loading

This is a cumulative source update based on the verified 0.31.1 updater (Git blob d8de01f5af9b840ce2e19a4db54dc6d0c68c7442) in repository commit 8648fbde698b092ebf004938f2cc94caaefb1047. Upload package.json and prida-update.mjs together to the repository root. Do not upload the ZIP without extracting it.

## Changes

- Timestamped vehicle pose sampling shared by the rendered chassis and chase camera, instead of an additional exponential pose lag.
- Own-hull camera queries ignore every record with the same vehicle ID, including a parked alias. Short intermittent gaps along obstacles no longer repeatedly extend the camera. Entering a vehicle starts the view facing forward, without subsequently overriding mouse input.
- Unarmed cars no longer run long-range weapon/terrain aim queries. Close-range camera collision probes remain active.
- Shared swept pedestrian contact in authoritative movement and client prediction. Nearby disabled/missing native hull colliders are recovered. Crushed vehicles are not resurrected, and wrecks remain solid.
- A fair shared budget allows at most one world/ground/scenery construction job per rendered frame. Render sectors are 96 m rather than 192 m; map size and gameplay IDs are unchanged. Individual construction jobs can still take longer than one frame budget.
- Vehicle spatial buckets update only on cell crossings. Sector cache invalidation includes an obstacle mutation counter, not merely array length. Site destruction checks are skipped while unchanged.
- Four-sector map, doors, runway fix, tank/aircraft controls and native destruction are retained. Project dependency versions are unchanged.

## Validation and limitations

185 isolated logic/regression tests passed. Seven controlled flat-level tests ran with the official Rapier 0.19.3 artifact and the release VehicleSystem. They cover disabled/missing collider recovery, pedestrian contact, entry/exit, stable parked collider handles and own-hull camera aliases. The controlled level uses reference terrain/registry/raycast helpers; it is not the full Arena or a graphics benchmark.

The complete game, browser rendering and actual FPS were not validated here. No frame-rate guarantee is made. The existing full-Arena, Three.js, world and Vite checks remain mandatory in the installer, with additional car/camera integration tests on the project's own dependencies. No GitHub write or Render deploy was performed by this package's preparation.

Expected in-game marker: 0.31.2 · CAR CONTACTS / CAMERA.
