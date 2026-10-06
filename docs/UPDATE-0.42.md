# PRIDA 0.42 — FPV items, animation, aircraft and AEGIS

## Source baseline

The implementation starts from the 0.41 cumulative payload in repository commit `6f21e6f9cef9b749636a3f97f6ac4b016e02fad1`. It was expanded through its normal staged installer and passed the existing release gates before these changes. The visible older source tree was not used as the gameplay baseline.

## FPV drones

The appended catalog entry preserves existing weapon indices. Quantity lives in the ordinary inventory slot's `ammo` field; there is no second `fpvCharges` authority. Base/NOVA pickups and recovered drops use the same five-drone limit. Random chests do not generate FPV items.

Select the item and press fire to launch one. N quick-launches a stored item or ends a current link. Release the launch trigger before detonating. Ending a link with fire held cannot launch a second item. Invalid stacks, blocked space, ineligible movement states and cooldown rejection spend nothing. Cancellation, range loss, destruction and battery expiry do not refund the launched item.

Backspace and the inventory drop button drop the complete held item or stack. Rarity and ammunition are preserved. Partial pickup leaves unaccepted FPV units in the same world drop; other supplies are collected only once. Death spills unused items and cancels the active drone. Respawn cannot restore spent or dropped items. Inventory uses the normal private `self.slots` network envelope.

## Imported animation

Both existing character GLBs contain thirty supplied motions: eight individual files and 22 motion files from the archive. Bind-direction retargeting accounts for different source and target arm poses. Movement loops, one-shot attacks, shot events, rifle upper-body layering and reload timing use these clips. The death model stays visible until its imported fall finishes.

Original mesh geometry is preserved. Horizontal root translation is removed so animation cannot change authoritative travel or aim. Bone positions and rotations are restored before animation and pose adaptation. Conversion from the uploads produces deterministic GLBs. See `ANIMATIONS-0.42.md` for the full source list, action mapping and commands.

## Aircraft

Sixteen convex hulls were derived from `public/models/prida030/plane.glb`; its source hash is recorded with the geometry. Broad-phase bounds select candidates, while contact and bullet queries use component hulls with yaw, pitch and roll. Fuselage, wings, stabilizers, fin, engine, canopy, propeller and landing gear have separate volumes. Empty wing-tail gaps permit shots and player movement.

Flight adds persistent velocity, limited acceleration and turning, bank-related lift loss, stalls and unpowered gliding. Takeoff remains forward throttle and looking upward. Component movement is swept through Rapier, excluding sibling hulls. Wing strikes count as contacts; hard landings and front/side impacts use distinct damage rules.

Destruction removes all aircraft colliders. The snapshot retains destruction pose, velocity and time so a lost event can still produce wreckage. Triangles from the visible model separate into fuselage, wings, tail, canopy, propeller and gear. Pieces inherit velocity, spin, fall and bounce. Cosmetic debris causes no extra damage, expires after 18 seconds and is capped at 64 fragments. A new round clears the prior aircraft ID so it can break again.

Wing gun origins and the reticle follow visible barrel tips. The existing eight aircraft rockets stay finite and inherit actual aircraft velocity.

## AEGIS

Space starts a gradual 0.42-second takeoff phase. Directional movement accelerates, boosted flight leans the body, releasing thrust preserves momentum, and contact cancels velocity into an obstruction. The powered ceiling eases at 142 game metres.

Regular pulses start at the right palm; the charged beam starts at the chest reactor. A shared hardpoint function supplies authority, third-person emitters, shoulder tubes and first-person positioning. The camera chooses a target, with a second body-to-emitter check preventing shots through nearby cover.

Two shoulder launchers contain three rockets each. R or the touch ROCKET button spends one rocket and six energy, with a 0.85-second cooldown. `gear.rocketAmmo` survives equipment drops. Projectiles accelerate, have bounded lifetime/count, sweep their full travelled segment and generate one terminal blast. A selected FPV item takes priority over suit weapons. Special movement is not replayed by ordinary walking prediction.

## Validation and limits

New tests exercise native Arena/Rapier geometry and contact, triangle-preserving breakup, repeated destruction and network snapshots, imported clip playback and bone transforms, FPV conservation, suit muzzle alignment on the actual Three.js model, and swept rocket impacts. Existing cumulative release gates remain enabled.

Unmodified 0.41 already fails historical full-suite expectations about the weapon catalog, starting loadouts and world layout. An old network fixture can wait indefinitely for a starting weapon that no longer exists. Those unrelated tests have not been removed or relabelled as passing.

CPU diagnostic renders inspect actual deformed character and aircraft vertices; they are not in-game screenshots. Here local Chromium terminated before opening a page, and the cloud browser refused localhost with `ERR_BLOCKED_BY_CLIENT`. Live WebGL presentation, touch play and device FPS still require browser playtesting. Neither production deployment nor portal publication is included in this code update.
