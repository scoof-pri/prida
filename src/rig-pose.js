// Posing the character rig on top of its animation clips.
import * as T from 'three';

// A bone of the character rig by its name in the modelling tool. The glTF loader strips characters that animation
// paths reserve ('UpperArm.L' becomes 'UpperArmL'), so looking the raw name up finds nothing.
export function rigBone(body, name) {
  return body.getObjectByName(name) || body.getObjectByName(T.PropertyBinding.sanitizeNodeName(name)) || null;
}
// Bones the game turns after the animation: the torso bends with the aim, the arms spread in free fall, reach up to
// the glider bar and tip the gun down to reload.
export const POSED_BONES = ['Torso', 'UpperArm.L', 'UpperArm.R', 'LowerArm.L', 'LowerArm.R'];
// three's mixer only writes a bone when its animated value changes. In a held pose (a clip whose keys do not move
// that bone, a paused game) it leaves the bone alone, and a turn added on top the frame before stays there: the
// next frame adds another, and the torso tumbled over and over (0.20.4–0.21.1). So before every mixer update the
// posed bones get back exactly what the mixer last gave them, and that is saved again right after the update.
export function restorePose(v) {
  v.posed ??= (v.posedNames || POSED_BONES)
    .map((n) => rigBone(v.body, n))
    .filter(Boolean)
    .map((bone) => ({ bone, base: bone.quaternion.clone() }));
  for (const b of v.posed) b.bone.quaternion.copy(b.base);
}
export function savePose(v) {
  for (const b of v.posed || []) b.base.copy(b.bone.quaternion);
}
