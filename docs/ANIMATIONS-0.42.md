# Uploaded character animations — PRIDA 0.42

The eight supplied FBX files and the 22 motion files inside `Action Adventure Pack (1).zip` are now embedded as 30 real animation clips in both `tactical-player.glb` and `aegis-player.glb`. The character geometry remains the articulated user-supplied STL geometry introduced in 0.41. `Ch15_nonPBR.fbx` provides the matching Mixamo reference skeleton; its duplicate character mesh and textures are not sent to the game.

## Gameplay mapping

| Supplied file | In-game use |
| --- | --- |
| Rifle Aiming Idle (1).fbx | Rifle ready stance, including upper-body aiming while walking or running |
| Firing Rifle (1).fbx | Rifle recoil, also combined with moving legs |
| Reloading (1).fbx | Standing and moving reloads, synchronized to the weapon's remaining reload time |
| Stepping Backward (1).fbx | Actual forward-playing backward steps |
| Strafing (1).fbx | One-shot entry into a lateral crouched step; mirrored for the opposite direction |
| Dying (1).fbx | Full fall and ground pose before the body starts fading into the ground |
| Drop Kick (1).fbx | Alternate bare-hands attacks |
| Double Dagger Stab (1).fbx | Blade attacks |
| Pack walking/running/idle files | Walking, running, idle and stopping |
| Pack jumping up/falling idle/hard landing | Takeoff, airborne motion and landing |
| Pack left/right turn | Turning steps while standing |
| Pack crouched sneaking left/right | Sustained sideways movement after the strafe entry |
| Remaining pack files | Preserved as named clips, with cover, crouch and roll aliases available to the renderer |

`Strafing (1).fbx` is a transition into a low stance rather than a seamless repeating stride. It plays once, then blends into the supplied crouched-sneaking loop. The reverse direction mirrors the pose and swaps left/right bones; it does not play gravity or foot contacts backward.

## Retargeting and playback

The Mixamo source uses 65 bones, while the game's current STL rigs use 18 bones. The importer maps the torso and limbs, collapses the extra spine/shoulder chain through world rotations, and preserves each target rig's own bone lengths. It corrects anatomical bind directions separately for the tactical model's outstretched arms and AEGIS's lower arm posture. The target rigs have no articulated finger bones, so finger motion is not reproduced.

Horizontal root motion is removed from the clips because the authoritative character controller already moves the player's collision capsule. Vertical motion remains; a measured floor correction prevents the different target boots and body proportions from penetrating the ground. Animation rotation is sampled at 30 Hz and optimized with glTF Transform resampling, deduplication and pruning.

`src/character-animations.js` composes aiming, firing and reloading above moving legs. It corrects the abdomen against the gait's pelvis rotation so the gun's orientation does not inherit the source rifle stance's hip yaw. One-shot attacks restart on a new shot event and persist beyond the short recoil timer. `src/rig-pose.js` restores both bone rotations and positions before the mixer runs, preventing flight overlays from leaving a shifted pelvis behind.

The 0.41 authored clips remain fallbacks for actions without corresponding supplied motion, such as a short fist jab and yes/no gestures. The actual imported clips replace idle, gait, aim, fire, reload, takeoff, falling, landing, death, knife and kick motion.

## Rebuild

With project dependencies installed and Python 3 available, run from the repository root:

```sh
node scripts/prepare-uploaded-animations.mjs /path/to/the/uploaded-files
```

The folder must contain the eight named FBX attachments and `Action Adventure Pack (1).zip`. An optional second argument selects a separate output directory for review. Sources are never changed. Temporary extraction stays in `TMPDIR` or the current working directory and is removed after conversion.

`scripts/strip-uploaded-fbx.py` removes mesh, skin, material and embedded-image FBX objects while retaining the original skeleton, curve properties and timings. The Node importer retargets those small motion-only FBX files and replaces only the animation bank of the existing game GLBs. Re-importing into already updated GLBs produces identical output without retaining orphan animation accessors.

`public/models/animation-manifest.json` records the source filenames, archive membership, durations, original-source SHA-256 hashes, stripped-motion hashes and resulting GLB hashes. The two final GLBs are 1,372,740 and 1,247,020 bytes respectively; no FBX or embedded source textures are loaded by the browser.

## Validation

`tests/animations-042.test.mjs` checks source coverage, hashes and size, finite normalized animation tracks, fixed horizontal root motion, world-space upper-body aiming, the strafe entry/loop transition, forward-playing backpedaling, reload synchronization, melee restarts and restoration of flight pelvis offsets. `tests/characters-041.test.mjs` exercises the imported and fallback clips against both actual skinned meshes, verifies finite deformation and cloned skeleton isolation, and checks suit flight.
