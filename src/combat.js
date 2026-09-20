export const EYE_HEIGHT = 1.6;
export function direction(angle, pitch = 0) {
  return { x: Math.sin(angle) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(angle) * Math.cos(pitch) };
}
export function relativeMove(right, forward, angle) {
  const n = Math.max(1, Math.hypot(right, forward));
  return {
    x: (Math.sin(angle) * forward - Math.cos(angle) * right) / n,
    z: (Math.cos(angle) * forward + Math.sin(angle) * right) / n,
  };
}
export function rayBox(origin, dir, min, max, range) {
  let near = 0,
    far = range;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(dir[k]) < 1e-8) {
      if (origin[k] < min[k] || origin[k] > max[k]) return Infinity;
    } else {
      let a = (min[k] - origin[k]) / dir[k],
        b = (max[k] - origin[k]) / dir[k];
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (far < near) return Infinity;
    }
  }
  return near;
}
