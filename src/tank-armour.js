// Fictional arcade armour. Values and face tests describe this game's chassis only.
export const ARMOUR_FACES = Object.freeze(['front', 'left', 'right', 'rear', 'top']);
const PROFILES = Object.freeze({
  tank: Object.freeze({ front: 420, left: 240, right: 240, rear: 160, top: 120 }),
  twin: Object.freeze({ front: 360, left: 210, right: 210, rear: 140, top: 100 }),
  sam: Object.freeze({ front: 240, left: 140, right: 140, rear: 100, top: 80 }),
});
const finitePoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
export function armourProfile(v) {
  if (v?.kind !== 'tank') return null;
  return Object.hasOwn(PROFILES,v.variant) ? PROFILES[v.variant] : PROFILES.tank;
}
export function refillArmour(v) {
  const profile = armourProfile(v);
  v.armour = profile ? { ...profile } : null;
  return v.armour;
}
export function armourSnapshot(v) {
  const profile = armourProfile(v);
  if (!profile) return null;
  return Object.fromEntries(ARMOUR_FACES.map(k => [k,
    Math.max(0, Math.min(profile[k], Number.isFinite(v.armour?.[k]) ? v.armour[k] : profile[k]))]));
}
// Ray from the centre toward the source, in chassis-local coordinates. Scale by half-extents:
// the first box face reached wins, not simply the largest raw world-space delta.
export function armourFace(v, source) {
  if (!finitePoint(source) || !finitePoint(v)) return 'front';
  const dx = source.x - v.x, dz = source.z - v.z;
  const a = Number.isFinite(v.angle) ? v.angle : 0, c = Math.cos(a), s = Math.sin(a);
  const w = Math.max(.3, Number.isFinite(v.bodyW) ? v.bodyW : 3.2);
  const d = Math.max(.3, Number.isFinite(v.bodyD) ? v.bodyD : 5.5);
  const h = Math.max(.3, Number.isFinite(v.bodyH) ? v.bodyH : v.variant ? 3.4 : 2.55);
  const x = (c * dx - s * dz) / (w / 2), z = (s * dx + c * dz) / (d / 2);
  const y = (source.y - v.y - h / 2) / (h / 2);
  if (y > .01 && y >= Math.max(Math.abs(x), Math.abs(z))) return 'top';
  if (Math.abs(z) >= Math.abs(x)) return z >= 0 ? 'front' : 'rear';
  return x >= 0 ? 'right' : 'left';
}
export function absorbArmour(v, damage, { source = null, kind = 'kinetic' } = {}) {
  const amount = Number.isFinite(damage) && damage > 0 ? damage : 0;
  const profile = armourProfile(v);
  if (!amount || !profile || v.hp <= 0 || v.crushed || kind === 'collision' || kind === 'environment')
    return { hull: amount, absorbed: 0, face: null, broken: false };
  if (!v.armour) refillArmour(v);
  const face = armourFace(v, source), before = Math.max(0, Math.min(profile[face], v.armour[face] || 0));
  // Armour never makes the hull invulnerable: blast leaks more damage than bullets.
  const absorbed = Math.min(before, amount * (kind === 'blast' ? .55 : .75));
  v.armour[face] = Math.max(0, before - absorbed);
  return { hull: amount - absorbed, absorbed, face, broken: before > 0 && v.armour[face] === 0 };
}
export function damageContext(arena, attacker, explicit = null) {
  if (explicit) return explicit;
  if (arena?._vehicleImpact037) return arena._vehicleImpact037;
  if (finitePoint(attacker)) return { kind: 'kinetic', source: { x: attacker.x, y: attacker.y + 1.6, z: attacker.z } };
  // Crashes, falls and environmental damage without a weapon source bypass the plates.
  return { kind: 'environment' };
}
