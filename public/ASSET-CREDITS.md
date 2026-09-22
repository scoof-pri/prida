# PRIDA — Asset credits

All assets below were downloaded from their authors' public distribution links on 2026-09-17. Their source pages identify the packs as CC0. Copies of Kenney's supplied license notices are in `licenses/`. No assets are fetched from these sites during gameplay.

## Quaternius — Toon Shooter Game Kit (CC0)

Source: https://quaternius.com/packs/toonshootergamekit.html
Author's download: https://drive.google.com/drive/folders/1-BDs_EIyd6uiF2XuoyiZEcqnMQIJrE0C
License: https://creativecommons.org/publicdomain/zero/1.0/

- Character_Soldier → soldier.glb
- Character_Hazmat → hazmat.glb
- Character_Enemy → scout.glb
- AK → rifle.glb; Shotgun → shotgun.glb; Pistol → pistol.glb; SMG → smg.glb; Sniper → sniper.glb; RocketLauncher → rocket.glb
- Each character includes the author's 17 skeletal clips. Runtime uses idle, movement, shooting, jumping, hit reaction and death clips. First-person weapon recoil, reload, switch, sprint and healing poses are game-authored procedural animation.
- 0.7: the weapon attachments bundled with the character rigs are also exported as standalone models: Knife_1 → knife.glb, Knife_2 → dagger.glb, Shovel → shovel.glb, Revolver → revolver.glb, Revolver_Small → handcannon.glb, GrenadeLauncher → grenadelauncher.glb, Sniper_2 → marksman.glb (scripts/build-weapon-assets.mjs).
- Adaptations: glTF to embedded GLB conversion, keyframe resampling, deduplication, scale and grip alignment. The original character weapon attachments are used, with the heavy weapon replaced by Kenney's model.

## Kenney — City Kit (Suburban / Commercial / Industrial), CC0

Sources:
- https://kenney.nl/assets/city-kit-suburban
- https://kenney.nl/assets/city-kit-commercial
- https://kenney.nl/assets/city-kit-industrial

30 distinct source models: suburban building-type-a through k (11), commercial building-a through l (12), industrial building-a through g (7).

Adaptations: normalized game scale; geometry below y=3.84 m clipped and replaced with game-authored ground floors, interiors, open doors, signs and collision. Upper storeys are scenery. Names such as cafe, clinic and bank describe gameplay variants, not the authors' original asset labels. Texture images are embedded in the GLBs.

Since 0.20 these building models are no longer drawn: buildings, their upper storeys and roofs are game-authored geometry (see below). Their proportions (height and storey count per model name) still size the buildings.

## Kenney — Blaster Kit, CC0

Source: https://kenney.nl/assets/blaster-kit

- blaster-p → lmg.glb, used as the TITAN heavy automatic weapon.
- crate-wide → chest.glb; the lid is animated by the game.

## Kenney — Furniture Kit, Car Kit, City Kit (Roads), CC0 (added in 0.8)

Sources: https://kenney.nl/assets/furniture-kit · https://kenney.nl/assets/car-kit · https://kenney.nl/assets/city-kit-roads (downloaded 2026-09-18). Licence notices: `licenses/furniture-kit.txt`, `licenses/car-kit.txt`, `licenses/city-kit-roads.txt`.

- Furniture: loungeSofa, loungeChair, tableCoffee, table, chair, televisionModern, cabinetTelevision, bookcaseOpen, desk, chairDesk, computerScreen, kitchenFridge, kitchenStove, bedDouble, pottedPlant, lampRoundFloor, trashcan, rugRectangle, cardboardBoxClosed.
- Cars: sedan, taxi, police, van, suv, hatchback-sports, delivery.
- Streets: light-square, light-curved, traffic-light, electricity-pole-single, dumpster, construction-cone, construction-barrier, road-sign-stop.
- Adaptations: scaled to metres, footprint centred, embedded GLB (`decor-*.glb`) by `scripts/prepare-decor.mjs`.

## Poly Haven textures, CC0 (0.20)

Source: https://polyhaven.com (licence: https://polyhaven.com/license — CC0). Each set was downloaded at 1K and resized to 512 px JPEG as three maps: colour (`<name>.jpg`), OpenGL normal map (`<name>_n.jpg`) and ambient occlusion / roughness / metalness (`<name>_arm.jpg`), by `scripts/fetch-textures.py`. Asset → game name:

brick_4 → bricks · painted_plaster_wall → plaster · brushed_concrete → concrete · asphalt_02 → asphalt · square_brick_paving → paving · forrest_ground_01 → grass · brown_mud_leaves_01 → dirt · coast_sand_01 → sand · floor_tiles_06 → tiles · laminate_floor_02 → wood · grey_roof_tiles_02 → roof · metal_plate → metal · bark_brown_02 → bark · rock_boulder_dry → rock · clay_roof_tiles_02 → claytiles · corrugated_iron_02 → corrugated · tarred_gravel → gravel · rough_linen → fabric · oak_veneer_01 → oak · concrete_wall_008 → panels · concrete_pavement → sidewalk · pine_bark → pinebark.

They replace the ambientCG colour maps used from 0.8 to 0.19 (Grass004, Ground037, Ground054, Asphalt012, PavingStones070, Plaster001, Bricks059, WoodFloor051, Concrete034, Tiles012).

## ambientCG leaf atlases, CC0 (0.20)

Source: https://ambientcg.com (licence: https://docs.ambientcg.com/license/ — CC0). LeafSet024 (beech leaves) and LeafSet019 (thuja sprays), 1K PNG colour and opacity, composed into the foliage cards `leaves.webp` and `needles.webp` by `scripts/make-foliage.py`.

## Game-authored work

Map generation, first-floor architecture, parks and terrain, trees and rocks, collision proxies, navigation, HUD, inventory, radar, rules, projectile and loot systems, procedural first-person motion, lighting and shader effects, pooled combat particles and synthesized sound. Wall panels, windows, curtains, doors, rubble, trash bags, destruction, haze and fire effects are game-authored. 0.20: roofs (gable, hip, flat with parapets and rooftop plant, shed, saw-tooth), chimneys and smokestacks, facade bands, plinths, sills and lintels, window frames and glass, trees, bushes, ferns, flowers, reeds, cacti, logs, hay bales, rocks, 3D grass, rubble heaps, the sky and clouds, and all surface shaders are procedural and game-authored. Weapon icons are software renders of the attributed models above. 0.7: katana.glb, crossbow.glb, minigun.glb, jetpack.glb and glider.glb are game-authored low-poly models built from primitives in scripts/procedural-models.js.

## Quaternius — RobotExpressive (CC0 1.0)

Boss bodies (`models/boss.glb`): "RobotExpressive" by Tomás Laulhé (Quaternius), modifications by Don McCurdy, as shipped in the three.js examples (https://github.com/mrdoob/three.js/tree/r180/examples/models/gltf/RobotExpressive). CC0 1.0. Recoloured and fitted with extra parts at runtime.
