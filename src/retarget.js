// Moving animation clips between two skeletons that share bone names but not bone orientations or lengths (the
// Universal Animation Library mannequin and the Universal Base Characters bodies). Each bone keeps the world-space
// rotation it gets relative to its rest pose, so a pose reads the same on a body with a different rest posture;
// bone lengths stay the body's own, and the pelvis travels in proportion to the body's pelvis height.
import * as T from 'three';

// Rest pose of a node tree, by name: parent name, local rotation and position, and the world rotation (relative to
// the tree's top) in parents-first order.
export function restPose(root) {
  const bones = [],
    byName = new Map();
  root.updateMatrixWorld(true);
  const top = new T.Quaternion();
  root.getWorldQuaternion(top).invert();
  root.traverse((o) => {
    if (o === root || !o.name) return;
    const parent = byName.has(o.parent?.name) ? o.parent.name : null,
      world = o.getWorldQuaternion(new T.Quaternion()).premultiply(top),
      b = { name: o.name, parent, q: o.quaternion.clone(), p: o.position.clone(), world };
    byName.set(o.name, b);
    bones.push(b);
  });
  return { bones, byName };
}

const trackOf = (clip, bone, prop) => clip.tracks.find((t) => t.name === bone + '.' + prop);

export function retargetClip(clip, src, dst, name = clip.name) {
  const rot = new Map(),
    times = new Set();
  for (const b of dst.bones) {
    const t = trackOf(clip, b.name, 'quaternion');
    if (t) {
      rot.set(b.name, t.createInterpolant());
      for (const x of t.times) times.add(Math.round(x * 1e4) / 1e4);
    }
  }
  const pelvisTrack = trackOf(clip, 'pelvis', 'position');
  if (pelvisTrack) for (const x of pelvisTrack.times) times.add(Math.round(x * 1e4) / 1e4);
  const keys = [...times].sort((a, b) => a - b);
  if (!keys.length) keys.push(0);
  const out = new Map(dst.bones.filter((b) => rot.has(b.name)).map((b) => [b.name, new Float32Array(keys.length * 4)])),
    srcWorld = new Map(),
    dstWorld = new Map(),
    q = new T.Quaternion(),
    inv = new T.Quaternion(),
    local = new T.Quaternion();
  const invSrcRest = new Map(dst.bones.map((b) => [b.name, src.byName.get(b.name)?.world.clone().invert()]));
  keys.forEach((time, k) => {
    for (const b of dst.bones) {
      const s = src.byName.get(b.name);
      if (!s) {
        // A bone only the body has keeps its rest pose under its (moving) parent.
        const pw = b.parent ? dstWorld.get(b.parent) : null;
        dstWorld.set(b.name, pw ? pw.clone().multiply(b.q) : b.world.clone());
        continue;
      }
      const it = rot.get(b.name);
      if (it) {
        const v = it.evaluate(time);
        local.set(v[0], v[1], v[2], v[3]).normalize();
      } else local.copy(s.q);
      const sw = (b.parent && srcWorld.get(b.parent) ? srcWorld.get(b.parent).clone() : new T.Quaternion()).multiply(local);
      if (!b.parent) sw.copy(s.world).multiply(inv.copy(s.q).invert()).multiply(local);
      srcWorld.set(b.name, sw);
      // Same world-space turn away from rest on the body.
      const dw = sw.clone().multiply(invSrcRest.get(b.name)).multiply(b.world);
      dstWorld.set(b.name, dw);
      if (out.has(b.name)) {
        const pw = b.parent ? dstWorld.get(b.parent) : null;
        if (pw) q.copy(pw).invert().multiply(dw);
        else q.copy(b.world).multiply(inv.copy(b.q).invert()).invert().multiply(dw);
        q.toArray(out.get(b.name), k * 4);
      }
    }
  });
  const tracks = [...out].map(([bone, values]) => new T.QuaternionKeyframeTrack(bone + '.quaternion', keys, values));
  if (pelvisTrack) {
    const s = src.byName.get('pelvis'),
      d = dst.byName.get('pelvis'),
      k = s && d ? d.p.length() / Math.max(1e-6, s.p.length()) : 1,
      it = pelvisTrack.createInterpolant(),
      values = new Float32Array(keys.length * 3);
    keys.forEach((time, i) => {
      const v = it.evaluate(time);
      values[i * 3] = v[0] * k;
      values[i * 3 + 1] = v[1] * k;
      values[i * 3 + 2] = v[2] * k;
    });
    tracks.push(new T.VectorKeyframeTrack('pelvis.position', keys, values));
  }
  return new T.AnimationClip(name, clip.duration, tracks);
}
