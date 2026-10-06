# PRIDA 0.30 external asset sources

## New CC0 models selected for build-time acquisition

Provider: **3DAssets.dev**. The provider declares CC0 1.0 Universal and AI use. These are generic original designs, not branded Fortnite assets. Runtime animation, game physics, collision, weapons and effects are separate PRIDA code.

- Main Battle Tank, Tanks, Military Vehicles and Field Camp.
  - Pack page: https://3dassets.dev/packs/armoured-column-and-field-camp
  - Manifest: https://3dassets.dev/api/v1/packs/armoured-column-and-field-camp
  - Fallback pack scene: https://cdn.3dassets.dev/assets/23739/v1/model.glb
  - The selected single tank is static geometry with a named turret pivot. The installer can isolate its root from the pack scene.
- Radial Engine Warbird Fighter, Aircraft Fleet and Airfield.
  - Page: https://3dassets.dev/assets/aircraft-fleet-and-airfield-radial-warbird-fighter-95c4cb8f
  - Model: https://cdn.3dassets.dev/assets/32595/v1/model.glb
  - The provider lists 24,884 triangles and ten rigid node-transform clips (not a skeletal animation rig).

Licence reference: https://creativecommons.org/publicdomain/zero/1.0/

Acquisition result, source URLs and SHA-256 hashes of downloaded files are recorded in **public/prida030-assets.json** during installation. Listing a source here does not imply the binary was successfully downloaded: check that report.

## Existing assets retained
Street cars and indoor furniture continue to use the project's existing Kenney assets. Existing character models and texture files are not replaced by this update. Their original credits and licences remain in public/ASSET-CREDITS.md and public/licenses/.

## Authored geometry/audio
The military-base layout, arched hangar geometry, villa site props, model fallbacks, weapon effects and synthesized engine/weapon sounds are created by the update code. They are not represented as third-party downloads. Villa main buildings and interiors use the project's native generators.
