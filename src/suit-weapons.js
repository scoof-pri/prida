// Shared AEGIS hardpoints and fire control. The authority and render adapter use
// these same points; a camera ray selects the target but never launches a shot.
import { direction, EYE_HEIGHT } from './combat.js';

export const SUIT_RULES = Object.freeze({
  energy: 100, flightDrain: 13, boostDrain: 23, recharge: 18,
  speed: 22, boostSpeed: 33, climb: 12, acceleration: 28, braking: 34,
  verticalAcceleration: 32, coastDrag: .75, takeoff: .42, takeoffClimb: 6,
  ceiling: 142, shotCost: 4, shotDamage: 24, shotCd: .18,
  beamCost: 38, beamCharge: .8, beamCd: 3,
  rockets: 6, rocketCost: 6, rocketCd: .85, rocketDamage: 115,
  rocketRadius: 3.4, rocketStartSpeed: 38, rocketSpeed: 78,
  rocketAcceleration: 60, rocketLife: 4.2, rocketCap: 48,
});

const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, finite(v)));
const add = (a, b, distance = 1) => ({ x: a.x + b.x * distance, y: a.y + b.y * distance, z: a.z + b.z * distance });
function toward(a, b) {
  const x = b.x - a.x, y = b.y - a.y, z = b.z - a.z, length = Math.hypot(x, y, z);
  return { x: x / (length || 1), y: y / (length || 1), z: z / (length || 1), length };
}

export function suitDesiredLean(p) {
  if (!p.suitFlight || p.hp <= 0 || p.vehicle || p.inBus) return 0;
  const speed = Math.hypot(finite(p.suitVX), finite(p.suitVZ));
  const launch = 1 - clamp(p.suitTakeoff / SUIT_RULES.takeoff, 0, 1);
  return clamp(speed / 28, 0, 1) * clamp(1.28 - finite(p.pitch) * .38, .65, 1.52) * launch;
}
export function suitFlightLean(p) {
  return Number.isFinite(p.suitTilt) ? clamp(p.suitTilt, 0, 1.52) : suitDesiredLean(p);
}

// Uploaded suit height: 1.84 m. Its body leans around the hips, not around the feet.
export function suitBodyPoint(p, local) {
  const lean = suitFlightLean(p), c = Math.cos(lean), s = Math.sin(lean);
  const x = local.x, y = .93 + (local.y - .93) * c - local.z * s,
    z = (local.y - .93) * s + local.z * c;
  const yaw = finite(p.angle), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return { x: finite(p.x) + x * cy + z * sy, y: finite(p.y) + y, z: finite(p.z) - x * sy + z * cy };
}

export function suitAimBasis(p) {
  const angle = finite(p.angle), pitch = clamp(p.pitch, -Math.PI / 2, Math.PI / 2);
  return {
    forward: direction(angle, pitch),
    right: { x: -Math.cos(angle), y: 0, z: Math.sin(angle) },
    up: { x: -Math.sin(angle) * Math.sin(pitch), y: Math.cos(pitch), z: -Math.cos(angle) * Math.sin(pitch) },
  };
}

// Six visible tubes, alternating right/left shoulders, then advancing a row.
export function suitRocketMount(p, side = 1) {
  return suitBodyPoint(p, { x: -Math.sign(side || 1) * .30, y: 1.60, z: -.045 });
}
export function suitRocketPort(port = 0) {
  const index = clamp(Math.floor(port), 0, SUIT_RULES.rockets - 1), row = Math.floor(index / 2);
  return { side: index % 2 ? -1 : 1, right: row === 1 ? -.051 : row === 2 ? .051 : 0, up: row === 0 ? .05 : -.038 };
}
export function suitMuzzle(p, kind = 'palm', port = 0) {
  if (kind === 'beam') return suitBodyPoint(p, { x: 0, y: 1.45728, z: .172 });
  const basis = suitAimBasis(p);
  if (kind === 'rocket') {
    const tube = suitRocketPort(port), mount = suitRocketMount(p, tube.side);
    return add(add(add(mount, basis.right, tube.right), basis.up, tube.up), basis.forward, .32);
  }
  const shoulder = suitBodyPoint(p, { x: -.22448, y: 1.50328, z: 0 });
  return add(add(shoulder, basis.right, .035), basis.forward, .515);
}

// `ray` uses the normal authoritative world/player/vehicle query. Sweeping eye to
// hardpoint stops a camera looking around cover from firing through that cover.
export function suitFireSolution(p, kind, range, ray, port = 0) {
  const eye = { x: finite(p.x), y: finite(p.y) + EYE_HEIGHT, z: finite(p.z) };
  const muzzle = suitMuzzle(p, kind, port), f = suitAimBasis(p).forward;
  const sight = ray(eye, f, range), target = add(eye, f, sight.distance);
  const link = toward(eye, muzzle);
  const guard = link.length > .001 ? ray(eye, link, link.length) : null;
  if (guard && guard.distance < link.length - .01) {
    const to = add(eye, link, guard.distance), from = add(eye, link, Math.max(0, guard.distance - .035));
    return { from, to, dir: link, distance: guard.distance, hit: guard, target, blocked: true, muzzle };
  }
  const aiming = toward(muzzle, target);
  const dir = aiming.length > .001 ? aiming : f;
  const hit = ray(muzzle, dir, range), to = add(muzzle, dir, hit.distance);
  return { from: muzzle, to, dir, distance: hit.distance, hit, target, blocked: false, muzzle };
}
