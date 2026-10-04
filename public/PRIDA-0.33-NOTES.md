# PRIDA 0.33 — Stage 1: rooms, lifts and developer controls

Cumulative update for the verified 0.32 repository at ea7f040c395702cf7ee95f3b014076d430291f80. The installer retains the complete previous integration, four-sector world, vehicle contacts, camera, rockets and runway correction. It does not replace original sources with files from a 0.27 archive.

## Implemented

Houses, apartments and office floors receive purpose-specific partitions, room doors and furniture placement. Small upper floors have one apartment; sufficiently large floors may have two. Offices include workspaces, private offices, meeting rooms and washrooms. Mixed-use buildings retain their original ground-floor business and get apartments above it. Building types outside this scope retain their previous plans.

Multi-storey eligible buildings have a lift shaft, cabin, landing gates and floor selector. E calls a lift from a landing; E inside opens floor selection. Lift motion is authoritative, carries standing players and respects an occupied doorway. A destroyed shaft or collapsed storey disables the lift and removes its cabin and landing colliders. Native stair openings remain intact. Exact floor collars close the gap between the coarse floor-cell grid and the shaft.

Existing shipped furniture GLBs and PBR textures are reused, with added signage, skirting, ceiling fixtures, mailbox geometry and small desk/kitchen/washroom fittings. There is no new photoreal external furniture pack in this release. Lifts and fittings are instanced and streamed with their building. Nearby door interaction uses a local spatial index.

Settings contains DEVELOPER MODE, initially disabled. Debug entry and cheat controls are gated by it. Server-side online cheat restrictions remain unchanged. In Solo Debug, authorized infinite ammunition also supplies vehicle rockets, while cooldowns and projectile limits remain active. Aircraft ramming damages destructible targets and the aircraft itself.

## Remaining stages

Stage 2: varied building silhouettes, atrium mall and escalators, bank, natural landscape and base vegetation.
Stage 3: combat/collapse/flight/damage presentation, account persistence review and custom skins.
Stage 4: CrazyGames SDK and rewarded ads, submission material, real-game bot capture, trailer and screenshots.

## Validation boundary

Local checks exercise helper logic, an isolated actual Rapier 0.19.3 lift scene and the real floor-selector/developer UI modules in Chromium. They are not a full game session. The full original repository, pinned Rapier 0.19.0 / Three.js integration and Vite build are mandatory staging gates in the installer; they were not run locally. Graphics/FPS and multiplayer lift use still require in-game acceptance.

Upload package.json and prida-update.mjs together into the repository root. Do not upload either file to src/. Extraction is required when using the ZIP. The visible version marker is 0.33 · INTERIORS / LIFTS.
