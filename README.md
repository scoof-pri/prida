# PRIDA 0.42

A browser FPS by Mark Pridachin, with an English interface, desktop and touch controls, Three.js rendering, Rapier physics and an authoritative Node WebSocket server.

## This update

- **FPV inventory items:** collect drones at military bases or NOVA, select their slot and fire to launch. Five can be carried in total. Launch spends one item. Drop a stack with Backspace or the inventory button; partial pickup keeps the remainder on the ground. N quick-launches or ends an active link.
- **Uploaded animations:** both existing character models contain 30 motions from the supplied FBX files and Action Adventure Pack, including rifle aim/fire, reload, backward movement, side steps, running, jumping, falling, melee and death.
- **Aircraft:** sixteen convex hulls follow the actual model, including pitch and bank. Bullets, player contact, physics and blast distance agree on the shape. Flight has inertia, lift, stalls and unpowered descent. Destruction separates the visible model into moving pieces and removes its solid colliders.
- **AEGIS:** gradual takeoff and directional acceleration, retained momentum when thrust is released, a soft altitude ceiling, palm pulses, a chest beam and six shoulder rockets. Shot origins are shared by the model and the authority; rocket ammunition survives equipment drops.

See [the update notes](docs/UPDATE-0.42.md) and [animation source and retargeting details](docs/ANIMATIONS-0.42.md). Older descriptions are retained in [the historical README](docs/README-HISTORY-0.20.md); they do not describe the current inventory or world layout.

## Run locally

Use Node.js 22 or newer:

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

For the complete server and packaged client:

```sh
npm run build
npm start
```

Open `http://localhost:8080`. The server reads `PORT` when provided and exposes `/health`. A static client needs the matching server for online play; solo modes run in the browser. Use client and server from the same release.

## Controls added or changed in 0.42

| Action | Desktop | Touch |
| --- | --- | --- |
| Launch selected FPV | Select its slot, then LMB | Select its slot, then FIRE |
| Quick-launch / end FPV link | N | FPV inventory item / END LINK |
| Detonate active FPV | Release the launch trigger, then LMB | Release FIRE, then press again |
| Drop held item or stack | Backspace | Inventory: DROP HELD ITEM |
| AEGIS takeoff / powered flight | Hold Space; WASD steers; Shift boosts | Hold ascend; stick steers; sprint boosts |
| AEGIS descend | Hold C | Descend button |
| AEGIS palm / charged chest beam | LMB / hold RMB | FIRE / AIM |
| AEGIS shoulder rocket | R | ROCKET button |
| Aircraft takeoff | W to gain speed, look up to lift off | Forward stick and look upward |

R still reloads ordinary firearms. A selected FPV item temporarily uses the fire controls while AEGIS is equipped. Launching FPV requires standing on the ground with clear space ahead. Ending its link does not return an item.

## Source and verification

This repository now contains the complete expanded source. The 0.41 repository had newer source embedded in `prida-update.mjs` alongside older visible files; that verified payload was restored before developing 0.42. Development and builds use the checked-in source directly.

The optional cumulative updater is reproducible from the source:

```sh
node scripts/build-update.mjs
npm run verify:release
```

Verification checks that the embedded update matches the source, stages the update, runs retained release regression/integration gates plus the new 0.42 tests, and builds standalone, Basic portal and Full portal clients. It does not deploy a service. Docker and the Render Blueprint run these gates before producing the deployable build.

`npm test` also includes historical tests whose assumptions predate current gameplay. Some already fail or wait indefinitely on unmodified 0.41. They remain available; the cumulative release gates identify the maintained suite. Browser playtesting and measured device performance are separate checks.

## Packages and deployment

`npm run build` creates the standalone client in `dist/`, the Basic CrazyGames client ZIP and complete source archive in `release/`. The standalone server serves the matching download links. `npm run build:crazygames:full` creates the separate Full client package; platform approval remains required before enabling its existing ad integration. `npm run export:full` exports source, runtime assets, scripts, tests and documentation.

The full source archive excludes dependencies, account data, private environment files, git history and old archives. Large original FBX uploads are not runtime dependencies; compact GLBs and provenance hashes are included instead.

The existing `Dockerfile` and `render.yaml` describe the server deployment. Merging into the configured deployment branch can trigger Render auto-deploy. Keep credentials in hosting environment settings. The lobby credit remains exactly **made by mark pridachin**. Bots are identified as BOT; solo cheats stay unavailable online and disable rewards. Asset provenance is in `public/ASSET-CREDITS.md` and `public/models/animation-manifest.json`.
