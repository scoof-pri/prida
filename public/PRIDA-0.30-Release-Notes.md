# PRIDA 0.30 — Vehicles / Fort North (release candidate)

This update is cumulative. It includes the complete 0.29 doors/roof integration and the 0.29.1 door-cleanup changes. It replaces the broken partial 0.29.1 installer, not the repository's current source files with an older source tree.

## Installation
Unzip the update archive. Upload **package.json** and **prida-update.mjs** to the repository root, beside server.mjs. Do not upload the ZIP itself and do not put these two files in src/. Commit both files together. Existing npm build/dev/test/start hooks invoke the installer.

The expected source base is the GitHub main tree at 70a2c70f6f2de8bc2c5b3675786f512557c8a3ff, whose game modules are the verified 0.28.3 versions. The installer checks every affected source hash, builds the complete overlay in a staging directory, runs logic tests, an actual Rapier/Arena test and a Vite bundle check. Only then does it commit source edits. A different base is rejected without overwriting it. Repeated runs verify the installed hashes instead of adding duplicate patches.

The marker in the menu becomes **0.30 · VEHICLES / FORT NORTH**. Intermediate installers are not needed.

## Driving and combat
- E: open/close a nearby door, enter a nearby empty vehicle, or exit your vehicle. Cars/tanks require slowing down before a normal exit. Exiting a plane in flight starts the existing glider/fall state.
- W/S: throttle/reverse on the ground; throttle/decelerate in a plane. A/D: steer; bank and turn in flight.
- Space: brake on the ground. Aircraft: Space climbs and C descends, after sufficient takeoff speed.
- Tank: mouse rotates the turret; LMB fires its cannon; RMB fires the machine gun. Aircraft weapons point along the nose: LMB cannon, RMB machine guns.
- R: request a three-second repair/refuel/rearm stop on a marked service pad.

The mobile overlay supplies MG, brake, climb/descend, service and exit buttons while retaining the movement stick and fire control. A vehicle HUD shows hull, speed, fuel, ammunition, MG heat and service status. Ordinary weapon HUD elements return on exit.

Two tanks and two fighters are placed at Fort North. There are three fixed civilian cars at the base/villas plus a bounded subset of the existing street cars. The total cap is 28 vehicles; not every parked car is movable. One driver per vehicle; passenger seats and AI tank/aircraft pilots are not included. Host/server authority controls movement, occupancy and damage. This is arcade flight/vehicle physics, not a full aviation or tracked-vehicle simulator.

## Locations
Fort North is north of the old city boundary, with an airstrip, runway lights, two arched hangars, armory, command building, barracks, gate, cover and service area. Villa Solara and Villa Vista are south of the city, each with a furnished main house and guest house, upstairs rooms, patio, pool, pergola and a car/service space. SOLO DEBUG's J menu contains travel buttons to all three locations.

Buildings use the existing destructible walls/floors/interiors. Added site props use native destruction IDs; a hangar roof or guard platform loses collision and visibility when its supports fail. Driver occupancy is released on death/disconnect. Doors disappear with their parent building/storey. Vehicle wrecks remain solid cover.

## Models and effects
The build attempts to install two original CC0 GLBs from 3DAssets.dev: Main Battle Tank and Radial Engine Warbird Fighter. Files are served locally by the game after installation, not fetched from third parties during a match. The provider labels these models as AI-assisted/generated. No Fortnite models or animations are included.

The downloaded fighter has rigid-node animation clips. The code connects propeller/canopy clips and adds runtime control-surface movement. Tank turret movement, gun elevation/recoil where model pivots permit, tracks/wheels on the rigged fallback, engine sounds, muzzle flashes, tracers and damage smoke are implemented in code. A rotating animated skeletal driver pose is not included: seated player meshes are hidden inside the vehicle.

If an external GLB is unavailable, malformed, or has an unsupported decoder/pivot, the explicit built-in fallback is used and labelled in the HUD. The build log and **prida030-assets.json** report which model was used. Set **PRIDA_REQUIRE_CC0_ASSETS=1** in the build environment to require the internet models and reject a fallback. Set **PRIDA_OFFLINE_ASSETS=1** to intentionally use only the built-in alternatives. These options do not require credentials.

## Verification status
Locally exercised: 66 isolated geometry, door, vehicle-control, asset-validation and support/destruction tests; installer contract tests; responsive HUD checks in Chromium. Vehicle-rule tests use explicit query/physics doubles; they are not a complete Rapier playtest. The actual Rapier/Arena integration test and full Vite check are shipped as installation gates and have not been run in the authoring environment. External model binaries were not downloaded or visually inspected in that environment. Complete gameplay, multiplayer sessions, plane landings, all map seeds and frame-rate budgets still require playtesting. This is a release candidate, not a claim that every requested feature is production-validated.

On an installation-gate failure, retain the first error and the preceding lines of the build log. Do not repeatedly layer older patches over the new installer.
