// Corner minimap: the map is drawn once to an offscreen canvas, then a rotating window around the player is
// copied each frame (forward is always up). Overlays: safe zone, bus route, bosses, relics, portals, squad.
import { BOSSES, RELICS } from './bosses.js';

const ZONE = {
  quarry: '#b6a180',
  grove: '#456b53',
  hill: '#6f8a58',
  park: '#638661',
  forest: '#3f6446',
  lake: '#4f8fa0',
  desert: '#d2b77e',
  glade: '#7fa860',
  meadow: '#93b260',
};
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1.6; // pixels per metre on the base image
    this.range = 70; // metres from centre to edge
  }
  setMap(map) {
    if (this.map === map) return;
    this.map = map;
    const L = map.limit,
      s = this.scale,
      c = document.createElement('canvas');
    c.width = Math.ceil(L.x * 2 * s);
    c.height = Math.ceil(L.z * 2 * s);
    const g = c.getContext('2d'),
      X = (x) => (x + L.x) * s,
      Z = (z) => (z + L.z) * s;
    g.fillStyle = '#8c9a7c';
    g.fillRect(0, 0, c.width, c.height);
    for (const p of map.parks) {
      g.fillStyle = ZONE[p.type] || '#638661';
      g.fillRect(X(p.x - p.w / 2), Z(p.z - p.d / 2), p.w * s, p.d * s);
    }
    g.fillStyle = '#5a6663';
    for (const r of map.roads) g.fillRect(X(r.x - r.w / 2), Z(r.z - r.d / 2), r.w * s, r.d * s);
    for (const w of map.waters) {
      g.fillStyle = '#3f84a4';
      if (w.lake) {
        g.beginPath();
        g.ellipse(X(w.x), Z(w.z), 18 * s, 18 * s, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#7fa860';
        g.beginPath();
        g.arc(X(w.x), Z(w.z), 4.5 * s, 0, Math.PI * 2);
        g.fill();
      } else g.fillRect(X(w.x - w.w / 2), Z(w.z - w.d / 2), w.w * s, w.d * s);
    }
    for (const b of map.buildings) {
      g.fillStyle = b.category === 'industry' ? '#b19d80' : b.category === 'home' ? '#c3cfb3' : '#b9c6c4';
      g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * s, b.d * s);
      g.strokeStyle = '#46524f';
      g.lineWidth = 1;
      g.strokeRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * s, b.d * s);
    }
    g.fillStyle = '#2f5a3a';
    for (const [x, z] of map.trees) {
      g.beginPath();
      g.arc(X(x), Z(z), 1.3 * s, 0, Math.PI * 2);
      g.fill();
    }
    this.base = c;
  }
  draw(state, me, angle, extras = {}) {
    const { ctx, canvas } = this,
      W = canvas.width,
      H = canvas.height,
      L = this.map.limit,
      k = W / 2 / this.range,
      s = this.scale;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#233e42';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    // Forward (sin a, cos a) in map pixels points up on screen.
    ctx.rotate(-Math.PI / 2 - Math.atan2(Math.cos(angle), Math.sin(angle)));
    ctx.scale(k / s, k / s);
    ctx.drawImage(this.base, -(me.x + L.x) * s, -(me.z + L.z) * s);
    ctx.scale(s / k, s / k);
    const P = (x, z) => [(x - me.x) * k, (z - me.z) * k];
    if (state.zone) {
      const [zx, zz] = P(state.zone.x, state.zone.z);
      ctx.strokeStyle = '#87dfff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(zx, zz, state.zone.radius * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (state.bus?.active) {
      const [ax, az] = P(state.bus.ax, state.bus.az),
        [bx, bz] = P(state.bus.bx, state.bus.bz),
        [cx, cz] = P(state.bus.x, state.bus.z);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, az);
      ctx.lineTo(bx, bz);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd05a';
      ctx.fillRect(cx - 5, cz - 3, 10, 6);
    }
    for (const d of state.relics || []) {
      const [x, z] = P(d.x, d.z);
      ctx.fillStyle = '#' + (RELICS[d.relic]?.color || 0xffffff).toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.moveTo(x, z - 6);
      ctx.lineTo(x + 5, z);
      ctx.lineTo(x, z + 6);
      ctx.lineTo(x - 5, z);
      ctx.fill();
    }
    for (const b of state.bosses || []) {
      if (b.hp <= 0) continue;
      const [x, z] = P(b.x, b.z);
      ctx.fillStyle = '#' + BOSSES[b.kind].color.toString(16).padStart(6, '0');
      ctx.strokeStyle = '#1a1010';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, z, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a1010';
      ctx.fillRect(x - 3, z - 2, 2, 2);
      ctx.fillRect(x + 1, z - 2, 2, 2);
    }
    for (const [owner, pair] of Object.entries(state.portals || {}))
      for (const [which, color] of [
        ['a', '#2f9bff'],
        ['b', '#ff8a1f'],
      ]) {
        const p = pair[which];
        if (!p || owner !== me.id) continue;
        const [x, z] = P(p.x, p.z);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, z, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    for (const o of state.players) {
      if (o.id === me.id || o.hp <= 0 || o.team !== me.team) continue;
      const [x, z] = P(o.x, o.z);
      ctx.fillStyle = o.helperOf ? '#ffb070' : '#98ffe0';
      ctx.beginPath();
      ctx.arc(x, z, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const m of extras.markers || []) {
      const [x, z] = P(m.x, m.z);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, z, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // The player: an arrow pointing up, and a north marker on the rim.
    ctx.fillStyle = '#98ffe0';
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2 - 8);
    ctx.lineTo(W / 2 + 6, H / 2 + 6);
    ctx.lineTo(W / 2, H / 2 + 2);
    ctx.lineTo(W / 2 - 6, H / 2 + 6);
    ctx.fill();
    const north = -Math.PI / 2 - Math.atan2(Math.cos(angle), Math.sin(angle)) - Math.PI / 2;
    ctx.fillStyle = '#f7edd8';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', W / 2 + Math.cos(north) * (W / 2 - 10), H / 2 + Math.sin(north) * (H / 2 - 10));
    ctx.strokeStyle = '#d5e6d355';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
