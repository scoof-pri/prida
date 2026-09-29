// Third-person aiming. The camera sits behind the shoulder, so the ray through the crosshair and the line the
// simulation fires along (from the eye, combat.js EYE_HEIGHT) are two different lines: firing along the camera's
// angles sent every shot parallel to the crosshair ray, off to one side — up to a couple of metres at range (the
// "shoots to the left of the crosshair" report). Instead the client finds what the crosshair is on and sends the
// angle and pitch from the eye to that point, so the shot lands where the crosshair points.
import { rayBox } from './combat.js';
import { castMap } from './raycast.js';
import { bossHeight, bossWidth } from './bosses.js';

export const AIM_RANGE = 300;
// Closer than this to the eye (the crosshair on a wall you are hugging) the camera's own angles are kept, so a
// surface right beside you cannot swing the shot sideways.
export const AIM_NEAR = 1.5;

// The first thing along the camera's centre ray: the map, another player's hitbox (the simulation's box) or a
// boss. The search starts level with the eye, so a lamp post between the camera and your own back is ignored.
export function crosshairTarget(cam, fwd, eye, map, { players = [], bosses = [], selfId = null, range = AIM_RANGE } = {}) {
  const start = Math.max(0, (eye.x - cam.x) * fwd.x + (eye.y - cam.y) * fwd.y + (eye.z - cam.z) * fwd.z),
    from = { x: cam.x + fwd.x * start, y: cam.y + fwd.y * start, z: cam.z + fwd.z * start };
  let distance = map ? Math.min(range, castMap(from, fwd, range, map).distance) : range,
    what = distance < range ? 'map' : 'sky';
  for (const o of players) {
    if (o.id === selfId || !(o.hp > 0) || o.inBus) continue;
    const y = o.y || 0,
      d = rayBox(from, fwd, { x: o.x - 0.34, y, z: o.z - 0.34 }, { x: o.x + 0.34, y: y + 1.9, z: o.z + 0.34 }, distance);
    if (d < distance) {
      distance = d;
      what = 'player';
    }
  }
  for (const b of bosses) {
    if (!(b.hp > 0) || b.under) continue;
    const h = bossWidth(b.kind) / 2,
      d = rayBox(from, fwd, { x: b.x - h, y: b.y, z: b.z - h }, { x: b.x + h, y: b.y + bossHeight(b.kind), z: b.z + h }, distance);
    if (d < distance) {
      distance = d;
      what = 'boss';
    }
  }
  return { x: from.x + fwd.x * distance, y: from.y + fwd.y * distance, z: from.z + fwd.z * distance, what };
}

// Angle and pitch of the line from `eye` to `point`, in the convention of combat.js direction().
export function aimAt(eye, point) {
  const dx = point.x - eye.x,
    dy = point.y - eye.y,
    dz = point.z - eye.z;
  return { angle: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

// The line of fire for what the crosshair is on, as offsets to add to the look angles (so they stay right while
// the mouse keeps moving between two frames).
export function convergedAim(cam, fwd, eye, look, map, opts) {
  const target = crosshairTarget(cam, fwd, eye, map, opts);
  if (Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z) < AIM_NEAR) return { angle: 0, pitch: 0, target };
  const a = aimAt(eye, target);
  return {
    angle: Math.atan2(Math.sin(a.angle - look.angle), Math.cos(a.angle - look.angle)),
    pitch: a.pitch - look.pitch,
    target,
  };
}
