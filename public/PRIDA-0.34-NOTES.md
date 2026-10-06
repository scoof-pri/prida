# PRIDA 0.34 — Stage 2: city architecture and countryside

Cumulative on 0.33, verified upstream main f9bfc1bd269727882ca97fb2c664f1062f5c35a4.
Upload package.json and prida-update.mjs together at the repository root. Do not put these files in src/.

## Scope
Big City gains four original landmark designs per copied district: Glass Arcade (three retail floors, 24 store units, open atrium, two pairs of conveyors, lift, backup stairs and individually breakable glass roof panes); Civic Bank (public hall, tall windows, customer advice, private office, WC and upper administration gallery); Court Gardens (U-shaped residence, open courtyard and subdivided apartments); Terrace House (office with a set-back top floor and accessible terrace).

The new shells use the same native wall/window/slab records as their colliders and damage. Atrium and stair/lift apertures are actual absent slab regions. Custom buildings are excluded from the old rectangular roof field and full-footprint ground-floor overlay. Rooms reuse shipped GLB furniture and photographed PBR surfaces; no new photorealistic external model collection is included.

Escalators use a fixed inclined collision ribbon and animated, instanced horizontal treads. Their conveyor displacement passes through the existing character controller: it is not a teleport. Motor destruction stops movement; ramp destruction hides the treads. Stopped conveyors remain walkable inclined surfaces. The lift and stairs are alternatives. Server snapshots carry the shared time and stopped/broken state. The release does not simulate each individual tread as a rigid body.

Countryside features: four bounded mountain ridges, two winding rivers and two lakes per template, distributed around the city. Terrain rendering, collision and ray heights sample one global lattice. Maximum added profile amplitudes are 24–42 m (the exact summit is modulated, not guaranteed to equal the amplitude). Water is a clipped surface over a carved bed, not a ground collider at zero. Timber footbridges include approach ramps. This is surface terrain, not underground caves, swimming or a boat system.

Base landscaping adds up to 16 clear-ground trees and two small open service shelters, retaining the command building and barracks. Existing apron, runway, roads and service zones are protected. Open courtyard grass is restored; no grass is drawn in new river/lake water or through the base apron. No artificial thick tree line is placed across take-off paths.

## Performance and ownership
Existing four-copy world, vehicles, aircraft/tank rockets, door/lift logic and Developer Mode remain. New IDs and absolute hull geometry are independently translated per copy; local footprint arrays are not translated. Nearby water geometry uses the shared one-build-job frame budget. Conveyor treads share instanced buffers and animate only for visible groups. Water triangles are built in 64 m regions and distant regions are released. Extra glass uses shared material batches; finite pool/roof objects still have a bounded cost. No measured whole-game FPS promise is made.

## Reference and asset provenance
The models here are original procedural gameplay adaptations, not measured replicas, and contain no copied brand identity.
- Benoy, Westfield London: glazed public atrium and retail-loop spatial idea: https://www.benoy.com/projects/westfield
- BIG, Otto Wagner Postsparkasse: public banking hall and bright metal/stone banking architecture: https://www.big.at/projekte/otto-wagner-postsparkasse
- Rapier character controller API: https://rapier.rs/docs/user_guides/javascript/character_controller/
No photographs from those pages are redistributed. Existing asset licences/credits remain in public/ASSET-CREDITS.md and public/PRIDA-0.30-Asset-Credits.md.

## Validation boundary
Isolated pure tests, a native plot-allocation diagnostic, and isolated real Rapier 0.19.3 transport tests are run locally. Full Arena/Three/Vite and live multiplayer verification remain in the atomic installation gate on the project's pinned dependencies (Rapier 0.19.0). The gate is not bypassed. A local whole-game session/FPS measurement is not claimed. Diagnostic captures show generated geometry only, not the full game with all textures and GLBs loaded.
