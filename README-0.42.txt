PRIDA 0.42.0 — FPV ITEMS / FLIGHT / MOTIONS
made by mark pridachin

WHAT CHANGED
FPV drones are finite, stackable inventory items in normal equipment slots. Collect at base/lab stands or use the developer inventory. Select the slot, then press the fire/use button or N to launch. N ends the link. Failed or blocked launches do not consume the item. Existing battery, range, collision and deliberate detonation rules remain authoritative.

The KESTREL uses 13 independently oriented convex collision shapes: tapered fuselage sections, wings, stabilizers, fin, canopy, landing gear and the rotating propeller envelope. Bullets can pass through empty space outside those shapes. The released mesh is the bundled KESTREL calibrated to these shapes, not an unrelated external optional model.

Airplane flight now uses acceleration, momentum, lift, drag, banked steering, reduced lift in a stall and unpowered descent. Hold W and look upward for the takeoff run. Pitch builds progressively; the aircraft cannot hover from a standing start. This is a tuned game flight model, not an aeronautical simulator.

Destroyed aircraft break into actual mesh fragments. These fragments inherit aircraft motion, tumble, collide locally and fade after 12 seconds. At most three wrecks / 24 fragments are simulated. The server handles damage once; cosmetic fragments do not produce client-only damage. Destroyed intact colliders are removed.

AEGIS: hold Space for thrust, WASD to move, Shift to boost, Space+C to descend. Takeoff ramps rather than immediately snapping the player upward. Releasing Space stops powered flight but preserves momentum. The pulse starts at the right gauntlet, the beam at the chest; both converge toward the crosshair and check intervening walls. Q fires a shoulder missile, one per press. There are six missiles, with energy cost and cooldown. R starts sequential reloading while grounded and not firing. A mobile missile button is included.

UPLOADED MOTIONS
Eight standalone FBXs plus 22 clips from Action Adventure Pack were converted to 30 compact clips for each of the two supplied character rigs. The game uses the supplied walk, run, aim, firing, reload, strafe, backpedal, jump, landing, dying, dagger and kick motions. Cover/turn variants are preserved in the library; this release does not add a cover mechanic. Root X/Z translation is removed so animation cannot move the authoritative player through walls.
public/animations/uploaded-042.json includes input filenames and SHA-256 provenance. It does not contain the uploaded source textures or duplicate character meshes. No new third-party animation downloads are required.
Rebuild from the original uploads:
  python scripts/strip-uploaded-fbx.py UPLOAD_DIRECTORY STRIPPED_DIRECTORY
  node scripts/import-motions-042.mjs STRIPPED_DIRECTORY

FULL SOURCE ARCHIVE
Install Node.js 22. In the extracted game directory:
  npm ci
  npm run test:release
  npm run build
  npm start
Open http://localhost:8080. For development use npm run dev.
The full source is already expanded. Do not run the old 0.41 installer over it.

GITHUB UPDATE ARCHIVE
This separate archive is for the existing scoof-pri/prida repository. Copy all five files from the update archive with their paths preserved: root package.json, package-lock.json, prida-update.mjs and README-0.42.txt, plus tests/build-entrypoints.test.mjs. The test file is required because GitHub CI checks the release before the installer runs. No deletion of the existing src/public folders is needed.
The new prebuild hook verifies and installs the cumulative source/asset payload before building. The installer stages its changes, runs the current regression gate and three Vite builds, and backs up replaced files. It makes no GitHub writes and reads no credentials. Commit these files in your own branch and review before merging.
The implementation has not been merged or deployed to the live repository by this delivery.

VALIDATION
See public/PRIDA-0.42-VALIDATION.md for the checks actually run and their limitations. This release does not claim successful end-to-end WebGL browser playtesting or real online multiplayer testing in the build environment.
