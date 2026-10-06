# PRIDA 0.31 — Four sectors

Cumulative update for main@0e2e6c6974d09ceb1b6e69b863867cfb775edb09.
Upload package.json and prida-update.mjs to the repository root, then build. Do not upload the ZIP itself.
No secrets are read and no repository writes are made by the installer.

## World
Big City becomes a 2 by 2 copy of the complete 0.30.1 world: twice the width and twice the depth,
not four times each dimension. District/Mini modes keep their original dimensions.
Four city cores, four Fort North bases and eight villa complexes retain their local layout.
Road strips connect the old margins. The only boundary walls are on the outer perimeter.
Door, panel, prop, vehicle, loot and boss IDs are unique; mutable cell masks are independent.
Terrain and convex roof positions, window holes, site support references and service pads are translated.
The number of human/bot contenders is not multiplied. Big City Royale gets a 12-minute base clock plus bus time.

## Detail and destruction
Additional trees, ferns and low banks surround the bases and villas without blocking the runway or roads.
Long base walls become independent modules no wider than 1.8 m and no taller than 1.15 m.
Arched hangar roof strips are divided along their length into sections up to 5 m.
They use native prop damage, support collapse, network state and collision removal.
The extra shard pool is visual only, capped at 128, and expires; it is not an unbounded rigid-body simulation.
Generated tank/aircraft models get rigid grilles, ports, fittings and surface detail merged by material.
External CC0 models and the earlier rig fallback rules are preserved; there are no new external model dependencies.

## Bounded runtime work
World/scenery geometry is created near the camera by 192 m sectors and unloaded with hysteresis.
Ground meshes are built directly as local 96 m chunks with matching lattice vertices and normals.
Static Rapier shapes are paged around live players and moving unmanned vehicles.
Dormant objects remain in the damage registry so long-range destruction is not lost.
Door and vehicle boxes remain resident. All map metadata still exists on the CPU: this is not server sharding.
Pathfinding keeps its one-metre occupancy grid but allocates its A* work only for visited nodes.
The minimap backing canvas is capped at 2048 pixels on its longest side for the large map.
Sleeping cars, sparse vehicle snapshots, mouse-controlled flight and independent turret controls remain enabled.

## Validation and limitations
The release includes isolated algorithm/geometry/installer tests and real-engine integration gates.
The real Rapier/Three integration and full Vite linking must pass in staging before source files are committed.
A failed gate leaves the source tree unchanged; keep the first error from the build log.
The full browser game and frame rate were not measured in the preparation environment.
Progressive sector loading can be visible immediately after a teleport; a very large map can still be CPU-bound.
This update does not add arbitrary mesh fracture, tunnel digging, or unrestricted destruction of road foundations.
Gameplay controls are unchanged. SOLO DEBUG travel shortcuts include each base on the large map.

Marker after a successful build: 0.31 · FOUR SECTORS
