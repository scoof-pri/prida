# PRIDA — baseline for a new chat

Paste this file into a new chat together with `PRIDA-baseline-full.zip` (the whole project including git history).
The project is at version **0.20** on the `master` branch: stage 1 of the 4-stage remake (section 6) is done.
The next step is stage 2 (0.21).

## 1. What the game is

- **PRIDA**: a low-poly, first-person battle-royale shooter for the browser (PC and mobile). The target platform is CrazyGames.
- Author: Mark Pridachin (user "Yuri", pridachin@gmail.com). He is in Turkey and talks in Russian, often with typos or in the wrong keyboard layout (for example "cnjq" is "стой").
- **Stack**: Three.js 0.180, Rapier 3D (`@dimforge/rapier3d-compat` 0.19), Vite 7, a Node WebSocket server (`ws`) and Node's built-in `node --test`.
- Repository: **github.com/scoof-pri/prida** (public). The user uploads files through the GitHub web UI (at most 100 files per upload), so hand him zips of the changed files with their folder paths.
- Hosting: **Render free web service "prida"**.
  - Region: Frankfurt, runtime: Docker, URL: https://prida.onrender.com.
  - Auto-deploy on commit.
  - `/health` returns stats that can be fetched with curl: stepMs, worstStepMs, loopLagAvgMs, loopLagMaxMs, heapMB, rssMB, uptimeS.
- The user wants **free hosting that needs no bank card**.
  - PHP hosts such as InfinityFree cannot run the Node server.
  - To fix ping, private groups use direct WebRTC play (0.15).

## 2. Hard rules (keep them in every version)

- The name is PRIDA and the UI is in English. The lobby credit reads exactly **"made by mark pridachin"**. A test checks that shipped UI files contain no Cyrillic.
- First-person view; must work on PC and on mobile (touch buttons).
- Mini Royale = 10 contenders. Big City Royale = 24 in solo, and up to 10 humans online (bots fill the rest).
- **Bots are always labelled BOT.** Never present them as online players.
- Cheat code **250886** (flight, infinite ammo, god mode) works only in solo, never on the server, and turns off rewards. Bazooka code **112358** is also solo only.
- Never invent a server address and never put secrets in the client.
- Free hosting only. Nothing is sold for real money: coins, the battle pass and skills are all earned by playing.
- Workflow the user expects:
  - Split big requests into stages and deliver **one stage per message**, unless he says "do all".
  - Reply in Russian and keep replies short.
  - Give a GitHub-update zip plus a full zip, and republish the playable artifact.

## 3. Version history (brief)

| Version | Content |
|---|---|
| 0.8–0.12 | District map, destructible voxel walls (cells), furnished interiors, textures, picture/grading settings, codes |
| 0.13 | Big City map, online quick match (royale + 1v1 duel), private groups |
| 0.14 | View distance and culling, auto resolution, biomes (forest, lake, glade, meadow, desert), battle bus, minimap, bosses with relics |
| 0.14.1–0.14.3 | Online ping work: compact packets, Frankfurt region, client prediction and lag compensation, 30 Hz server, token bucket |
| 0.15 | Direct P2P play over WebRTC for private groups (`src/room.js`, `src/p2p.js`); the server only relays signalling |
| 0.16 | Big map about 10× the district (784×696 m: city core plus a ring of biomes), flats on upper storeys, decor, transparent breakable windows you can climb through |
| 0.17 | Bosses VIS/Strength (forest, TITAN GLOVES: one-shot melee plus QUAKE), IGNIS/Fire (desert, EMBER CORE: fire ring plus helper bots), NOEMA/Mind (glade, MIND CROWN: 5 s flashback), ENTROPIA/Chaos (meadow, CHAOS SHARD: CATACLYSM once per match plus LINE OF RUIN), NULL/Void (lake, portal gun). Smarter bots: retreat and heal, reinforce, peek from cover, suppressing fire, flee hazards. New effects (quake, rift, cataclysm, crit) |
| 0.18 | Wardrobe (COSMETICS tab): skins, accessories, weapon colours, patterns, charms, effects, emotes (key B). Battle pass: 30 free tiers, 250 XP per tier |
| 0.19 | SKILLS tab: coins buy ranks in STRENGTH and MOBILITY (each rank is a level, max 41). At 10 ranks: CYBER STRIKE and MOMENTUM (30 % each); DASH (key V) and 50 % faster sprint recharge. The server clamps ranks |
| 0.20 | Remake stage 1: PBR world (Poly Haven textures with normal and ARM maps, triplanar in world space), sky with clouds and environment reflections, procedural roofs, facade relief, window frames and glass, painted interiors, procedural trees and plants, 3D grass, rubble heaps; occlusion and storey culling, chunked static geometry, single-sided models. Client-only: no protocol or server change |

## 4. Code map (`src/`)

| File | Role |
|---|---|
| `simulation.js` (≈1.7k lines) | Authoritative `Arena`: players, Rapier physics, weapons, melee, projectiles, blasts, damage, bot AI (`botInput`), storm, bus, emotes, dash, perks, `snapshot()` |
| `world.js` | Deterministic map generation: `createWorld(seed, size)`, `MAP_SIZES` (district and city), blocks and roads, buildings and panels, window glazing (`glaze`), flats, biomes (`wild()`), `LAIRS` |
| `interiors.js` | Furnishing per building type; `apartmentPlan(b)` and `furnishFlat` for upper storeys |
| `cells.js` / `destruction.js` | Voxel wall cells (about 0.4 m), carving, collapses; destruction lists mirrored to clients |
| `raycast.js`, `spatial.js`, `navigation.js`, `terrain.js` | Rays through the obstacle grid (holes, windows), nav grid, terrain height and hills grid |
| `bosses.js` / `boss-view.js` | Boss AI, relics and abilities (`use`, `quake`, `cataclysm`, `rift`, portals, a pending-blast queue) / boss rendering (Quaternius RobotExpressive rig, recoloured, with extra parts) |
| `render.js` | Three.js view: people (Quaternius character rigs), first-person weapon, cosmetics (patterns, charms, accessories, effects, emotes), camera, HUD 3D bits |
| `scenery.js` | Instanced city scenery: `CulledBatch` (instances sorted by visibility group; only visible groups are uploaded), wall panels with facade bands/plinths, damaged walls as cell layers, windows (frames, sills, lintels, glass, curtains), doors, furniture, stairs, hides by id, roof break/drop, storey and building collapse |
| `culling.js` | `Culler`: visibility groups (building shell, building detail, one storey's contents, 16 m outdoor cells), frustum widened by the sun shadow, 720-bin occlusion horizon of intact buildings with door/window gaps, inside-building occluder, `hides()` point test for characters and loot |
| `materials.js` | Surfaces: `detailMaterial` (triplanar PBR in world space; `box`, `ceiling`, `interior` variants; lite path for Fast graphics), `uvMaterial`, ground (`makeGround`, `groundChunks`), sky with clouds, environment map, water, glass, foliage (wind sway, translucency), kit/car/street materials; `WORLD` (time, wind, sun) |
| `roofs.js` | Procedural roofs per building category (gable, hip, flat with parapet and plant, shed, saw-tooth), chimneys and smokestacks, merged per 128 m region; `hide(id)` and `copy(b)` for the falling roof |
| `nature.js` / `grass.js` | Procedural trees (broadleaf, pine), bushes, ferns, flowers, reeds, rocks, cacti, logs, hay as culled batches / instanced 3D grass patches around the camera (mask from parks, wind, bends around players) |
| `chests.js`, `rubble.js` | Instanced chest rendering / rubble heap geometry of a collapsed building |
| `assets.js` | Model and texture loading, `TEXTURES` table (colour, `_n`, `_arm` per set), `FOLIAGE` cards, texture-quality setting; models are single-sided except the glider |
| `effects.js` | Particles, tracers, explosions, shockwave rings (`groundRing`), quake, rift, cataclysm, crit |
| `cosmetics.js` | Cosmetics catalogue, `appearance()` / `pack()` (cosmetics travel as one short string), profile v2, battle pass |
| `skills.js` | Skill tree, `perks()`, `packSkills()` / `unpackSkills()`, `buyRank()` |
| `items.js`, `catalog.js` | Weapons (17), rarities, gear (jetpack, glider), loot, building types |
| `main.js` (≈1.8k lines) | App, UI, input, solo loop, online client (prediction), lobby tabs (PLAY, INVENTORY, COSMETICS, SKILLS, INFO), HUD |
| `room.js`, `p2p.js` | Host-in-browser rooms and WebRTC links |
| `minimap.js`, `grading.js`, `sdk.js`, `party.js` | Minimap, colour grading, CrazyGames SDK, room codes |
| `server.mjs` | WebSocket server: quick-match queues, parties, 30 Hz rooms, compact broadcast, signalling (`?signal=CODE&role=host|guest`), `/health` |

### Network protocol

- The client sends `input`, `ping`, `appearance`, `loadout`, `skills` and `start`.
- The server sends `welcome`, `state` (shared state plus `self.slots`), `pong` and `error`.
- Cosmetics are packed in `cosmetics`, perks in `skills`, and dash state in `dashCd` in the snapshot.

## 5. Commands and tooling

- Install and test:
  ```bash
  npm ci
  npm test   # 117 tests pass on master (0.20)
  ```
- Dev server:
  ```bash
  npx vite --port 5173 --host 127.0.0.1
  ```
  It sometimes dies; restart it when curl returns 000.
- Headless screenshots: `scripts/play-headless.mjs` (usage: `node scripts/play-headless.mjs ./script.mjs 1280 720 0`, where the script default-exports `async (page) => {...}`; Playwright with Chromium at `/opt/pw-browsers`; `Q=fast|quality` sets the graphics preset, default fast).
  - The script navigates, then control goes through the dev-only hook `window.__prida = {sim, state, view, socket, latency, selectSlot, setLook}`.
  - **Use `scripts/safe-run.sh ./shots.mjs W H log`** with `SHOTS='[{"name":"a","x":0,"z":0,"a":0,"p":0}]'` (`MODE=classic|city|...`): it stops the rAF loop, renders by hand and reads pixels back (`page.screenshot` of a SwiftShader canvas crashes), writes `shots/<name>.png`, and a watchdog kills Chromium before the sandbox runs out of memory. One shot per session: SwiftShader keeps every compiled shader (about 3 GB for a city view). Never `pkill -f play-headless` (it matches your own shell); use `pkill -9 -f "[h]eadless_shell"`.
  - **Caveat**: in the headless harness the frame loop and keyboard often do not advance. Check logic with direct `sim.input(...)` and `sim.step()`, or with unit tests. With rendering stubbed, instance buffer uploads accumulate as update ranges; never call `clearUpdateRanges()` outside a full refill.
- Build the playable Claude artifact:
  1. Build:
     ```bash
     VITE_MODEL_EXT=wasm npx vite build --outDir ../dist-artifact --emptyOutDir
     ```
  2. Rename `models/*.glb` to `*.wasm`.
  3. Rebuild the page from the head of the old page, the body of the built index.html and the script tag.
  4. Publish at https://claude.ai/artifact/SaUVdhe3929UxBwJQy1ChU, passing the new `assets/index-*.js` and `.css` files. The Artifact tool needs a `read` first.
- Deploy: the user commits the changed files on GitHub and Render builds the Dockerfile (`npm ci`, then `npm run build && npm prune`, then `node server.mjs`).

## 6. Current request: the 4-stage remake, 0.20–0.23

The user's request, translated:

- Remodel everything in one realistic, detailed style:
  - bots and players should not look cartoonish;
  - bosses should not look like big robots.
- Every surface (walls, cars, objects) gets textures with normal and reflection maps. Real bricks, and real 3D grass instead of a flat texture.
- Optimisation: do not render what is behind walls (occlusion) or back faces.
- Full animation pass:
  - several boss attacks, each with its own animation;
  - reloads (magazine out, thrown away, new one in);
  - running with a visible body and camera sway;
  - jetpack, glider, and jumping out of the bus.
- Particles: real brass shell casings instead of cubes, and muzzle fire.
- Gameplay:
  - chests in varied places and of different rarities, and fewer of them;
  - a more atmospheric bus flight with a jump animation and textures;
  - weak weapons no longer break buildings into cubes: cube resolution rises locally and a crater forms;
  - more weapons with special mechanics;
  - real flats and corridors in houses.
- Added in the same message: more interior (a lift, doors that open, and so on), an interface like Fortnite's, a friends system, and cosmetics previewed on the character in the inventory (not just a colour swatch).

He asked to split this into **4 equal stages, done step by step** (one stage per message).

| Stage | Scope |
|---|---|
| **1 (0.20) — World surfaces and performance** ✅ | Done, see below |
| **2 (0.21) — Models and lobby** | Realistic, more detailed characters for players and bots; new boss models that are distinct creatures, not the robot rig; more detailed weapons, battle bus and cars in one style. Fortnite-style lobby: a 3D character on a stage in the lobby, and the wardrobe/inventory previews skins, accessories and weapon finishes on the 3D model |
| **3 (0.22) — Animation, particles, HUD** | Reload with magazine out, thrown and inserted; running with body motion and camera bob; jetpack, glider and bus-jump animations; several boss attacks with their own animations; brass casings and muzzle flames; Fortnite-style in-match HUD |
| **4 (0.23) — Gameplay and interiors** | Chest placement and rarity tiers, fewer chests; atmospheric bus flight; local high-resolution crater damage for weak weapons instead of whole cubes; new special weapons; proper flats and corridors, lifts, doors that open; friends system (friend codes, online status, invite to a group; no accounts or secrets in the client) |

### Stage 1 (0.20): what was built

- Textures: 22 Poly Haven sets (512 px colour, `_n`, `_arm`; `scripts/fetch-textures.py`) and two foliage cards from ambientCG leaf atlases (`scripts/make-foliage.py`). Credits in `public/ASSET-CREDITS.md`.
- Materials (`materials.js`): world-space triplanar PBR with whiteout normal blend; `box` mode (dominant axis) for boxes; `interior` mode paints the inside face of outer walls as plaster (instanced `aOut` attribute); shared program key `pbr` keeps the shader count down; Fast graphics uses a lite path (one sample, no normal/ARM maps).
- Sky with procedural clouds captured by PMREM as `scene.environment`; glass (Fresnel alpha), glossy cars, metal, water reflect it.
- Buildings: city-kit building models are no longer loaded; facades per category (bricks, plaster, panels) with bands, plinths, sills, lintels, window frames; procedural roofs and chimneys (`roofs.js`); smokestacks on industry.
- Nature (`nature.js`), 3D grass (`grass.js`), chests (`chests.js`), rubble heaps (`rubble.js`).
- Visibility (`culling.js`, see code map). Static ground in 96 m chunks, static boxes and roofs in 128 m regions (fewer draw calls than smaller chunks).
- Measured in the headless harness: district street view 1.64 M → 171 k triangles; city avenue about 583 k triangles and 390 draw calls; culling costs 1–9 ms when the camera moves.
- Tests: `tests/world-render.test.mjs` (roofs, culling, batches, grass mask, nature slots, buffer upload ranges).

Ideas left for later stages: Kenney furniture and cars are still the cartoon kits (retexture or replace in stage 2); wall debris is still cubes (stage 3/4); lifts and opening doors need simulation support (stage 4).

### Research notes for later stages

- Poly Haven (CC0) is reachable with `curl -A "Mozilla/5.0"`; Python `urllib` gets 403.
  - API: `https://api.polyhaven.com/files/<id>`.
  - It also has CC0 models (grass_medium_01/02, fir_tree_01, fire_hydrant, barrels, furniture, `modular_urban_apartments_facade`, and more). They are photogrammetry and heavy, so they need decimating and LODs.
- Current characters are Quaternius rigs (soldier, hazmat, scout). Their clips are Death, Duck, HitReact, Idle, Idle_Shoot, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Run_Gun, Run_Shoot, Walk, Walk_Shoot, Wave, Yes.
- The boss uses the Quaternius RobotExpressive rig. For more realistic CC0 characters, consider Quaternius "Universal Base Characters" with the "Universal Animation Library" (CC0), or MakeHuman exports (CC0). Avoid Mixamo files, because redistributing them raw is restricted.
- The weapons are CC0 Kenney Blaster Kit models plus procedural models (`scripts/`). Cars and furniture are Kenney kits (cartoonish), so Stage 2 should replace or retexture them.
