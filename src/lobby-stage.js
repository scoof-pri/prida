// The lobby stage: your operator on a lit platform high over the edge of the map, the city behind, framed to the
// right of the menu (in the middle on narrow screens). The character is drawn by the normal person code in
// render.js — main.js puts one player on the spot — so everything worn or held in a match shows here the same way:
// skin, uniform tint, headgear, weapon colour, pattern and charm, gear, emotes.
import './lobby-ui.js';
import * as T from 'three';
import { MAP_SIZES, mapSize } from './world.js';
import { objectSurface } from './materials.js';

// Where the stage floats: just outside the south edge of the map, above the rooftops, facing south (toward the
// camera) with the whole city behind.
export function lobbySpot(size = 'district') {
  const { rows } = MAP_SIZES[mapSize(size)],
    edge = rows * 13 + 10;
  return { x: 0, y: size === 'city' ? 46 : 34, z: edge + 14, face: 0 };
}
// Camera for the stage. `spot.shift` is how much of the screen (0–1, from the left) the menu covers: the
// character stands in the middle of the rest. Narrow screens get a wider, centred shot.
export function frameLobby(camera, spot, dt = 0) {
  const wide = camera.aspect > 1.15,
    fov = wide ? 34 : 44,
    dist = (wide ? 5.6 : 9.5) * (spot.party ? 1.45 : 1),
    f = spot.face,
    right = new T.Vector3(Math.cos(f), 0, -Math.sin(f)),
    half = Math.tan(T.MathUtils.degToRad(fov / 2)) * dist * camera.aspect,
    target = new T.Vector3(spot.x, spot.y + (wide ? 0.88 : 1.05), spot.z).addScaledVector(right, -(spot.shift || 0) * half);
  // Portrait: raise the character into the free band above the menu (lift = where that band's middle is, in
  // screen units from the centre upward).
  target.y -= (spot.lift || 0) * Math.tan(T.MathUtils.degToRad(fov / 2)) * dist;
  camera.position.set(spot.x + Math.sin(f) * dist, spot.y + 1.55, spot.z + Math.cos(f) * dist);
  camera.lookAt(target);
  if (camera.fov !== fov) {
    camera.fov = dt ? T.MathUtils.damp(camera.fov, fov, 10, dt) : fov;
    if (Math.abs(camera.fov - fov) < 0.05) camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}
// A round steel platform with a glowing rim and a soft pool of light under the feet. No extra lights: a light
// that only exists in the lobby would recompile every material when a match starts.
export function makeStage() {
  const g = new T.Group(),
    steel = objectSurface(new T.MeshStandardMaterial({ color: 0x2f3538, roughness: 0.38, metalness: 0.75, envMapIntensity: 1.1 }), {
      surface: 'steel',
      size: 1.4,
      strength: 0.5,
      normal: 0.6,
    }),
    trim = objectSurface(new T.MeshStandardMaterial({ color: 0x1d2224, roughness: 0.5, metalness: 0.6 }), { surface: 'worn', size: 1, strength: 0.5, normal: 0.7 }),
    top = new T.Mesh(new T.CylinderGeometry(1.35, 1.35, 0.14, 48), steel),
    base = new T.Mesh(new T.CylinderGeometry(1.42, 1.1, 0.5, 48, 1, true), trim),
    under = new T.Mesh(new T.CircleGeometry(1.1, 32), trim);
  top.position.y = -0.07;
  base.position.y = -0.39;
  under.rotation.x = Math.PI / 2;
  under.position.y = -0.64;
  const ring = new T.Mesh(
    new T.TorusGeometry(1.36, 0.028, 8, 96),
    new T.MeshBasicMaterial({ color: new T.Color(0xf5a56c).multiplyScalar(1.3), toneMapped: false }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.005;
  // Glow under the feet: a radial gradient drawn once.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d'),
    grad = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,214,170,0.55)');
  grad.addColorStop(0.55, 'rgba(245,165,108,0.18)');
  grad.addColorStop(1, 'rgba(245,165,108,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  const glowTex = new T.CanvasTexture(c);
  glowTex.colorSpace = T.SRGBColorSpace;
  const glow = new T.Mesh(
    new T.CircleGeometry(1.3, 48),
    new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.006;
  top.receiveShadow = true;
  top.castShadow = base.castShadow = true;
  g.add(top, base, under, ring, glow);
  g.visible = false;
  g.userData.ring = ring;
  return g;
}
