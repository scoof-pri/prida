// HUD extras (0.26): damage numbers over what you hit, and kill-feed lines with the weapon's icon.
import { Vector3 } from 'three';

// Numbers pop up where the hit landed and float away. Shotgun pellets on one target within a moment add up to one
// number, the way a single blast reads. Armour hits are blue, a killing or heavy hit is gold.
export class DamageNumbers {
  constructor(layer, max = 14) {
    this.layer = layer;
    this.max = max;
    this.recent = new Map(); // target id -> { el, n, t }
    this.v = new Vector3();
  }
  // Screen position of a world point, or null when it is behind the camera or off screen.
  static project(camera, x, y, z, w, h, v = new Vector3()) {
    v.set(x, y, z).project(camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }
  spawn({ id, n, armor = false, x, y, z, big = false }, camera, now = performance.now()) {
    if (!this.layer || !camera || !(n > 0)) return null;
    const last = this.recent.get(id);
    if (last && now - last.t < 90 && last.el.isConnected) {
      last.n += n;
      last.t = now;
      last.el.textContent = String(last.n);
      last.el.classList.toggle('big', big || last.n >= 60);
      return last.el;
    }
    const at = DamageNumbers.project(camera, x, y, z, this.layer.clientWidth || innerWidth, this.layer.clientHeight || innerHeight, this.v);
    if (!at) return null;
    while (this.layer.children.length >= this.max) this.layer.firstChild.remove();
    const el = document.createElement('i');
    el.className = 'dmg' + (armor ? ' armor' : '') + (big || n >= 60 ? ' big' : '');
    el.textContent = String(n);
    // A little scatter so several numbers on one target do not sit on top of each other.
    el.style.left = at.x + (Math.random() - 0.5) * 36 + 'px';
    el.style.top = at.y + (Math.random() - 0.5) * 14 + 'px';
    el.addEventListener('animationend', () => el.remove());
    this.layer.append(el);
    this.recent.set(id, { el, n, t: now });
    if (this.recent.size > 40) this.recent.clear();
    return el;
  }
  clear() {
    this.layer?.replaceChildren();
    this.recent.clear();
  }
}
// "ATTACKER [icon] VICTIM" for the kill feed; names go in as text, never as markup.
export function feedLine(attacker, victim, icon, mine = false) {
  const line = document.createElement('div'),
    a = document.createElement('b'),
    b = document.createElement('b');
  a.textContent = attacker;
  b.textContent = victim;
  line.append(a);
  if (icon) {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    line.append(img);
  } else line.append(document.createTextNode(' ✕ '));
  line.append(b);
  if (mine) line.classList.add('mine');
  return line;
}
