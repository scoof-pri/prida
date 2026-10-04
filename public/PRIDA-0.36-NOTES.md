# PRIDA 0.36 — HYDRA / AIR DEFENCE

Cumulative update over the verified 0.35.1 repository. Normal BASTION, aircraft rockets,
world sectors, lift/escalator, portal and asset-bootstrap integrations are retained.

## Vehicles
- HYDRA: the second tank at each base becomes an eight-station twin-rack tank.
  Infinite ammunition, 0.10 s missile interval and 0.25 s cannon interval.
  At most 16 of its missiles can be in flight. Hull/fuel are NOT infinite; MG can overheat.
- WARDEN: new player-operated tracked air-defence vehicle at each base. No autonomous firing.
  Six ready missiles + 18 reserve, 0.8 s launch interval, 5.5 s magazine reload.
  Aim at a hostile airborne plane for 1 s, within 550 game metres and a clear line of sight.
  LMB or Q fires. A/D/W/S drive, E enter/exit, R service at marked pads.
  The server chooses the target and advances guidance; clients cannot submit target IDs.
  Missiles turn at a bounded rate; intervening geometry stops them; loss/death of the target
  ends tracking without switching to another target. Four active missiles per WARDEN.
- New variants use generated articulated models, not unverified additional downloads.
- One HYDRA and WARDEN per base; four each on the four-sector Big City map.

## Performance
Dormant vehicles and stationary doors are excluded from per-tick simulation work;
new input, damage, terrain/support changes wake the necessary systems. Collider repair remains active.
Small support changes wake nearby vehicles through the spatial grid; queue overflow or global terrain changes retain a full safety audit.
Sparse door state only visits changed door records. Rocket rack hardware uses five instanced batches
per tracked launcher, rather than a separate draw object for every tube/rim/rocket.
The shared 64-projectile cap remains; firing pauses at the cap instead of evicting a live shot.
These changes do not establish a specific FPS improvement without a full hardware playtest.

## Downloads
The build generates `release/PRIDA-0.37-FULL-GAME.zip` and serves a copy from `dist/`.
On the standalone site: Developer Mode > INFO > CRAZYGAMES EXPORT >
DOWNLOAD ALL GAME SOURCES + ASSETS.
This export includes expanded source, server, all available models/textures/icons, scripts/tests,
and an integrity manifest. No account database, private env files, git history or node_modules.
Expanded source has no automatic patch hooks, so npm ci / npm run build / npm start work normally.
The separate CrazyGames ZIP is CLIENT ONLY. Do not upload the source ZIP to the portal.

## Installation
Upload package.json + prida-update.mjs in the repository root, in one commit.
Do not upload into src/. Do not layer old update files over this release.
Mandatory existing gates remain; new actual Arena/Three and Rapier air-defence gates are added.
No remote writes, secrets or Render settings are modified by this package.
