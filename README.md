# PRIDA — Mini Royale 0.8

A low-poly browser FPS by Mark Pridachin. English interface, desktop mouse/keyboard and touch controls. Built with Three.js, Rapier and Vite. Includes an optional authoritative Node WebSocket server.

## Play modes

- **Mini Royale:** 10 contenders total. Solo is one human plus nine bots. One life, no respawns. The safe circle waits 20 seconds, then shrinks from 140 m to zero over 220 seconds. Outside it, health is lost at 8 HP/s, increasing to 18 HP/s in the final minute. Last survivor wins. Eliminated players can watch a survivor or leave. Everyone fights everyone, including bots.
- **Survival:** one player versus 16 easier bots. Eliminated bots stay dead. Clear all enemies to win.
- **Training:** free-for-all with 16 bots, first to 10 eliminations or three minutes. Respawn after three seconds; automatic next round after seven seconds.
- **Private groups:** up to 10 humans. Create a group, copy its invitation link, or enter a friend's code. The host starts Mini Royale or Arena. Empty places are filled with bots so the starting roster is exactly 10. Groups are free-for-all, not teams. Lobby ownership transfers if the host leaves; an in-match disconnect becomes a bot. Mid-match joins are refused with an explanation. After a match, the host can replay with the same group or return everyone to its lobby.

The published static Site and the CrazyGames ZIP do **not** include a running multiplayer service. Online play (quick match Big City Royale and Duel, private groups) needs the included `server.mjs` deployed once, see **Free online server** below. Offline modes work immediately. This client requires the matching PRIDA 0.13 server.

## World and combat

208 × 176 m; 30 building models across 34 placed buildings, including six two-lot complexes; park, pond, pine grove, rocky clearing and physical hills. Ground floors are enterable; upper storeys are scenery with coarse collision. Seventeen weapons: rifle, shotgun, pistol, SMG, machine gun, sniper, rocket launcher, combat knife, shovel, katana, revolver, hand cannon, marksman rifle, grenade launcher, crossbow, minigun and throwing daggers. 44 chests plus death drops, finite ammo, armor, medkits, sprint stamina and a tactical map. The map shows all living opponents and remaining supplies by design.

Terrain is shared by rendering, physics and projectile collision. Explosions, smoke, sparks, debris, moving bullet tracers, impact marks and rocket exhaust use capped effects pools. Auto / Quality / Fast settings control pixel ratio, shadow resolution, bloom and particle counts. Camera aim is independent of character animation.

## District, destruction and bots (0.8)

- **Relief:** park hills, a quarry pit beside a spoil heap and a twin-peaked lookout hill. Roads and paths stay flat; everything shares one terrain for rendering, physics and shots.
- **Scenery:** furnished interiors (sofas, tables, TVs, beds, shelves, desks, fridges, cartons), windows with curtains, open doors, street lamps, traffic lights, stop signs, power poles, dumpsters with trash bags, roadworks and 40-odd parked cars. Walls, streets and floors use CC0 textures as detail over the flat palette.
- **Destruction:** ground-floor walls are made of panels. Explosions break panels and props, a lintel falls when a panel beside its doorway goes, and a building that loses half its walls (or a whole side and 30 %) collapses — upper storeys fall, occupants are crushed and rubble is left as cover. Cars take bullet and blast damage, explode and burn out as wrecks. Bots re-path through new holes. Destruction is simulated by the server and mirrored by clients from compact lists.
- **Bots:** squads (duos in Mini Royale, trios elsewhere, one side in Survival) with no friendly fire, shared sightings, focus fire, flanking, cover when hurt or reloading, healing in cover, chest looting and formation movement. Uniforms, operators and finishes are randomised. The last squad standing wins Mini Royale.
- **Effects and animation:** haze, chimney smoke, burning wrecks, building dust clouds, debris, landing dust, spawn light; per-weapon reloads (magazine, shells, cylinder, launcher, dagger draw), lower-and-raise weapon switching, landing dip, walking/running/landing character clips, a falling death camera with desaturation, and fallen characters sinking away.

## Loot, rarity and loadouts (0.7)

- **Inventory:** five slots. Slot 1 always holds a melee weapon; slots 2–5 hold guns. A full inventory swaps the held weapon and drops the old one at your feet with a beam in its rarity colour.
- **Rarity:** Common, Uncommon, Rare, Epic, Legendary. Higher rarity adds damage (up to +35 %), faster reloads (up to −22 %) and larger magazines (up to +30 %).
- **Chests:** each chest rolls a weapon and rarity from a per-map seed. Building chests are ordinary; park chests are better; the central supply crates are best. Every weapon type appears at least once per map. Chests can also hold medkits, armor and gear.
- **Melee:** knife (fast), shovel (heavy), katana (long reach). Melee hits the nearest opponent inside a swing cone with nothing solid in between.
- **Special weapons:** the grenade launcher and crossbow fire arcing projectiles; crossbow bolts and throwing daggers are silent and hurt only on a direct hit; the minigun spins up before firing and slows you down.
- **Gear:** jetpack (hold jump in the air, refuels on the ground) or glider (hold jump while falling). Found in chests or chosen in the loadout.
- **Starting loadout:** in the lobby choose a melee weapon, a primary, a secondary and gear. Starting items are Common. Power weapons (sniper, rocket, grenade launcher, crossbow, minigun, machine gun, marksman, hand cannon) come only from chests. The server re-validates every loadout.

## Cosmetic shop

Six finishes (including Field Issue) for all weapons and three operators: Ranger, Hazmat and Outrider. Start with 350 coins, Field Issue and Ranger. Finishes cost 100–300 coins; operators cost 200–250. Purchases are one-time; owned items can be equipped freely. Cosmetics never change combat statistics. Operator models are visible to other players and in the overhead lobby. Finishes appear on held weapons.

Complete a match lasting at least 20 seconds for 30 coins, plus 10 per elimination and 100 for a victory. Leaving early grants no reward. Any use of a cheat disqualifies the entire match, even after disabling it. This is a prototype, client-managed cosmetic economy without real money, paid products or a competitive leaderboard.

On CrazyGames, progress uses the SDK Data module when available. Elsewhere it is device-local browser storage. No cross-device account service is hosted by this project. If saving fails, the shop displays that progress lasts only for the current session.

## Controls and codes

WASD / arrows move; mouse looks; LMB fires; RMB aims; Space jumps; Shift sprints; R reloads; 1–5 / mouse wheel select inventory slots, Q returns to the previous one; hold Space in the air to use a jetpack or glider; E opens a nearby chest; H uses a medkit; I / M / Tab opens inventory; Esc pauses.

Touch: left stick, swipe the playfield to look, and separate fire, jump, sprint, aim, reload and loot buttons. The inventory handles equipment and healing. Landscape is recommended.

Open **Codes** in the lobby or **Codes / Cheat Menu** in pause and enter **250886**. Typing the six digits outside a text field also opens it. Toggles: flight, infinite ammunition and invulnerability. Flight uses Space / Up to rise, C / Down to descend, stops at 32 m, and respects buildings. Toggles remain selected until changed during the current page session. Cheats are enforced as disabled by the online server; it ignores forged cheat fields in input. Sandbox matches award no coins.

## Run locally

Node 22 or newer:

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:8080`. A group on that page automatically uses its own server. For frontend-only development use `npm run dev`. To verify game rules and networking run `npm test`.

For internet play, deploy this project with its Node server to a host supporting long-lived WebSockets. Build command: `npm ci && npm run build`. Start command: `npm start`. The server listens on `PORT` (default 8080), exposes `/health`, and serves `dist/`. `ALLOWED_ORIGINS` optionally accepts a comma-separated list of allowed browser origins. A reverse proxy must support WebSocket upgrades and TLS. A `Dockerfile` is included as an alternative. Configure the resulting public WSS URL in `public/config.json` as `multiplayerUrl`, rebuild, and upload the new client. Room codes are invitation locators, not authenticated accounts.

## Free online server (Render)

1. Push this project to a GitHub repository (the source project, not the client ZIP).
2. On render.com (free account): **New → Blueprint**, pick the repository. `render.yaml` creates a free web service: build `npm ci --include=dev && npm run build`, start `node server.mjs`, health check `/health`.
3. Open `https://<service>.onrender.com`. That page is the game with online enabled: `/config.json` answers `multiplayerUrl: "auto"`, so the client connects to the same host over WSS.
4. **Quick Match → Big City Royale** queues up to 10 humans (bots labelled BOT fill the rest after the countdown); **Quick Match → Duel** pairs two humans, first to 5 eliminations.

Free instances sleep after ~15 idle minutes (the first visit wakes them in about a minute) and have little CPU, so `PRIDA_MAX_ROOMS` is set to 6 and city rooms tick at 30 Hz. For another static host (CrazyGames, itch) set `multiplayerUrl` in `public/config.json` to `wss://<service>.onrender.com` and add that host to `ALLOWED_ORIGINS` on the server.

## CrazyGames

See `public/PRIDA-Upload-Guide.md` for submission steps and official references checked on 2026-09-17. The release client ZIP has `index.html` at its root and contains all 87 GLBs, textures, icons and license notices. Upload the client ZIP, not the source/server project. Basic Launch and Full Launch have different requirements; a packaged build is not platform approval.

The SDK adapter supports gameplay start/stop, Data, room information, invitation links and join callbacks. Actual portal integration, account transitions, mobile performance and marketplace acceptance still require testing in CrazyGames Preview. No ads or paid purchases are integrated. Game covers and preview videos are separate submission assets and are not included.

## Assets and maintenance

`public/ASSET-CREDITS.md` lists the original CC0 Kenney and Quaternius sources and adaptations. 87 self-contained GLBs total approximately 7.6 MB, plus ten 512 px textures (0.36 MB). Three character rigs each retain 17 animation clips; first-person motion is procedural. Models are already committed; rebuilding does not download them. `scripts/prepare-assets.mjs /path/to/asset-source` regenerates them from the original extracted packs.

## Verification and limits

Automated tests cover terrain, doors, movement, all weapons, loot, healing, armor, bot survival, stable look input, animation rigs, assets, English UI labels, cosmetic purchase/save rules, flight and cheat restrictions, the 10-player cap, storm damage, group host authority and real WebSocket clients. A full unattended Mini Royale reached a single survivor in simulation.

The supervised browser preview is unavailable in this environment, so this update has not received a full WebGL visual playtest or physical-phone performance check. The client is a prototype; no zero-bug or CrazyGames certification claim is made.
