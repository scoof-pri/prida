// Interiors: every building type has a purpose, and each storey is furnished for it (homes have kitchens,
// living rooms, bedrooms and bathrooms; cafes tables and a bar; offices desks; hospitals wards…). Buildings
// with upper storeys get block stairs along the east wall (see world.js `stairLane`), so the east strip is left
// free there. Layout is deterministic; items that do not fit are skipped by `put`.
import { DECOR_SIZES } from './decor-sizes.js';

const H = Math.PI / 2;
export const STAIR = { steps: 12, run: 0.5, width: 1.4 };
const FLOOR = (k) => (k === 0 ? 0 : 3.84 + (k - 1) * 3.6);

// Purpose shown in the Info tab and used for furnishing.
export const PURPOSE = {
  cottage: 'home',
  villa: 'home',
  duplex: 'home',
  bungalow: 'home',
  townhouse: 'home',
  lodge: 'home',
  residence: 'home',
  chalet: 'home',
  guesthouse: 'hotel',
  courthouse: 'home',
  cafe: 'cafe',
  pavilion: 'cafe',
  pharmacy: 'pharmacy',
  bookshop: 'bookshop',
  market: 'market',
  hotel: 'hotel',
  office: 'office',
  clinic: 'clinic',
  hospital: 'clinic',
  bank: 'bank',
  university: 'university',
  terminal: 'terminal',
  mall: 'mall',
  warehouse: 'warehouse',
  distribution: 'warehouse',
  factory: 'workshop',
  refinery: 'workshop',
  workshop: 'workshop',
  hangar: 'workshop',
  powerstation: 'workshop',
};

function room(b, k, ctx) {
  const base = FLOOR(k),
    hw = b.w / 2 - 0.45,
    hd = b.d / 2 - 0.45,
    stairs = (b.storeys || 0) > 0,
    walk = k === 0 ? b.door / 2 + 0.8 : 0.6,
    // East edge of the usable area beside the stairs (they occupy two lanes by the east wall, |z| < 3.8).
    stairX = stairs ? hw - 3.3 : hw,
    r = { b, k, hw, hd, walk, stairs, stairX, rand: ctx.rand, single: !stairs };
  const size = (name, opts = {}) => opts.box || DECOR_SIZES[name] || [1, 1, 1];
  r.at = (name, lx, lz, rot = 0, opts = {}) =>
    ctx.put(name, b.x + lx, b.z + lz, rot, { building: b.id, storey: k, ...opts, y: base + (opts.y || 0) });
  // Against a wall, front facing into the room. `t` runs along the wall.
  r.wall = (side, name, t, opts = {}) => {
    const d = size(name, opts)[2] / 2 + 0.03;
    if (side === 'w') return r.at(name, -hw + d, t, H, opts);
    if (side === 'e') return r.at(name, hw - d, t, -H, opts);
    if (side === 'n') return r.at(name, t, -hd + d, 0, opts);
    return r.at(name, t, hd - d, Math.PI, opts);
  };
  // Something standing on a placed item (a TV on its cabinet, a laptop on a desk…).
  r.on = (id, name, dy, opts = {}) => {
    if (id < 0) return -1;
    const d = ctx.decor[id];
    return r.at(name, d.x - b.x + (opts.dx || 0), d.z - b.z + (opts.dz || 0), d.rot + (opts.turn || 0), { ...opts, on: id, y: dy });
  };
  r.row = (side, names, t0, t1, gap = 0.1, opts = {}) => {
    const list = Array.isArray(names) ? names : [names];
    let t = t0,
      i = 0;
    const ids = [];
    while (true) {
      const name = list[i % list.length],
        w = size(name, opts)[0];
      if (t + w > t1) break;
      ids.push(r.wall(side, name, t + w / 2, opts));
      t += w + gap;
      i++;
    }
    return ids;
  };
  r.grid = (x0, x1, z0, z1, dx, dz, fn) => {
    let i = 0;
    for (let z = z0 + dz / 2; z <= z1 - dz / 2 + 1e-6; z += dz)
      for (let x = x0 + dx / 2; x <= x1 - dx / 2 + 1e-6; x += dx) fn(x, z, i++);
  };
  // Usable zones: west of the walkway, and east of it (minus the stairs strip where they are).
  r.west = [-hw, -walk];
  r.east = [walk, hw];
  // ---- sets ----------------------------------------------------------------------------------------
  r.dining = (x, z, name = 'table') => {
    if (r.at(name, x, z, 0) < 0) return;
    for (const dx of [-0.45, 0.45]) {
      r.at('chair', x + dx, z - 0.72, 0, { collide: false });
      r.at('chair', x + dx, z + 0.72, Math.PI, { collide: false });
    }
  };
  r.cafeTable = (x, z) => {
    if (r.at('table-round', x, z, 0) < 0) return;
    for (const a of [0, 2.1, 4.2]) r.at('chair', x + Math.sin(a) * 0.95, z + Math.cos(a) * 0.95, a + Math.PI, { collide: false });
  };
  // Desk facing north: the worker sits on the south side.
  const seat = b.type === 'office' || b.type === 'bank' ? 'office-chair' : 'chair';
  r.desk = (x, z, rot = Math.PI, gear = 'monitor') => {
    const id = r.at('desk', x, z, rot);
    if (id < 0) return id;
    r.on(id, gear, 0.785, { dz: -Math.cos(rot) * 0.15, dx: -Math.sin(rot) * 0.15 });
    r.at(seat, x + Math.sin(rot) * 0.7, z + Math.cos(rot) * 0.7, rot + Math.PI, { collide: false });
    return id;
  };
  r.stack = (x, z, levels = 1 + Math.floor(r.rand() * 3)) => {
    let id = r.at('box', x, z, r.rand() * 0.3);
    for (let l = 1; l < levels && id >= 0; l++) id = r.on(id, 'box', l * 0.6, { turn: r.rand() * 0.3 });
  };
  r.counter = (x, z, len, rot = 0, color = b.accent) => {
    const id = r.at('counter', x, z, rot, { box: [len, 1.05, 0.9], color });
    r.on(id, 'laptop', 1.05, { turn: Math.PI });
    return id;
  };
  r.machine = (x, z) => r.at('machine', x, z, 0, { box: [1.8, 1.5, 1.3], color: b.accent, hp: 160 });
  r.bedroom = (x, z, rot, name = 'bed') => {
    if (r.at(name, x, z, rot) < 0) return;
    const [w] = DECOR_SIZES[name],
      sx = Math.cos(rot) * (w / 2 + 0.45),
      sz = -Math.sin(rot) * (w / 2 + 0.45),
      back = -0.75,
      bx = Math.sin(rot) * back,
      bz = Math.cos(rot) * back;
    const t = r.at('side-table', x + sx + bx, z + sz + bz, rot);
    r.on(t, 'lamp-table', 0.55);
  };
  r.bathroom = (x, z) => {
    // A corner by the south wall: bathtub, toilet and sink side by side.
    r.at('bathtub', x, hd - 0.42, Math.PI);
    r.at('toilet', x + 1.35, hd - 0.45, Math.PI);
    r.at('sink', x + 2.05, hd - 0.26, Math.PI);
  };
  r.kitchen = (t0, t1) => {
    const ids = r.row('n', ['fridge', 'stove', 'kitchen-sink', 'kitchen-cabinet', 'kitchen-cabinet'], t0, t1, 0.02);
    const cab = ids[3];
    if (cab !== undefined) r.on(cab, 'microwave', 0.92);
    if (ids[4] !== undefined) r.on(ids[4], 'coffee-machine', 0.92);
  };
  r.plant = (x, z) => r.at('plant', x, z, 0, { collide: false });
  r.corners = () => {
    r.plant(-hw + 0.3, -hd + 0.3);
    r.plant(-hw + 0.3, hd - 0.3);
  };
  return r;
}

// ---- plans -------------------------------------------------------------------------------------------
const PLANS = {
  home: {
    ground(r) {
      const { hw, hd, walk } = r,
        wx = -(hw + walk) / 2;
      r.kitchen(-hw + 0.1, -walk - 0.1);
      r.dining(wx, -hd * 0.2);
      r.wall('w', 'sofa', hd * 0.5);
      r.at('coffee-table', -hw + 1.7, hd * 0.5, H);
      r.at('rug', -hw + 1.8, hd * 0.5, H, { collide: false });
      const tv = r.at('tv-cabinet', walk + 0.3, hd * 0.5, -H);
      r.on(tv, 'tv', 0.66);
      r.at('floor-lamp', -hw + 0.25, hd - 0.3, 0, { collide: false });
      r.wall('s', 'coat-rack', walk + 0.5);
      if (r.single) {
        // One-storey homes: bedroom and bathroom on the east side.
        r.bedroom((walk + hw) / 2 + 0.3, -hd + 1.1, 0);
        r.bathroom(walk + 0.2, 0);
        r.wall('e', 'bookcase', 0.2);
        r.wall('e', 'washer', hd * 0.3);
      } else {
        r.wall('e', 'bookcase', -hd + 0.8);
        r.wall('s', 'washer', r.stairX - 0.6);
        r.corners();
      }
    },
    upper(r) {
      const { hw, hd, walk } = r;
      r.bedroom(-hw * 0.55, -hd + 1.1, 0);
      r.bedroom(-hw * 0.55, hd - 1.05, Math.PI, 'bed-single');
      r.wall('w', 'bookcase-wide', 0);
      r.desk(Math.min(r.stairX - 0.9, 1.4), -hd + 0.45, 0, 'laptop');
      r.bathroom(walk, 0);
      r.at('shower', r.stairX - 0.6, hd - 0.6, Math.PI);
      const t = r.at('side-table', -walk - 0.2, 0.2, -H);
      r.on(t, 'tv-vintage', 0.55);
      r.at('rug', -hw * 0.45, 0, 0, { collide: false });
      r.corners();
    },
  },
  cafe: {
    ground(r) {
      const { hw, hd, walk } = r;
      const bars = r.row('n', 'bar', -hw + 0.2, -walk - 0.1, 0);
      r.on(bars[0] ?? -1, 'coffee-machine', 1.17);
      for (const id of bars) {
        if (id < 0) continue;
        r.on(id, 'stool', 0, { dz: 0.8, turn: Math.PI });
      }
      r.wall('n', 'fridge', walk + 0.6);
      r.grid(-hw, -walk, -hd + 2.6, hd, 2.5, 2.6, (x, z) => r.cafeTable(x, z));
      r.grid(walk, r.stairX, -hd + 1.2, hd, 2.5, 2.6, (x, z) => r.cafeTable(x, z));
      r.corners();
      r.wall('s', 'speaker', -hw + 0.4);
    },
    upper(r) {
      const { hw, hd } = r;
      r.grid(-hw, -0.6, -hd, hd, 2.4, 2.4, (x, z) => r.dining(x, z, 'table-cloth'));
      r.row('e', 'sofa-long', -hd + 0.3, -3.9);
      r.row('e', 'sofa-long', 3.9, hd - 0.3);
      r.corners();
    },
  },
  pharmacy: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.row('w', 'bookcase-wide', -hd + 0.3, hd - 0.3, 0.05);
      r.row('n', 'fridge', walk + 0.2, r.stairX - 0.2, 0.02);
      r.grid(-hw + 1.4, -walk, -hd + 1.6, hd - 1.2, 2.2, 3.0, (x, z) => r.at('bookcase-low', x, z, 0));
      r.counter(walk + 1.3, hd - 2.4, 2.6, 0);
      r.corners();
    },
    upper: (r) => PLANS.warehouse.upper(r),
  },
  bookshop: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.row('w', 'bookcase-wide', -hd + 0.3, hd - 0.3, 0.05);
      r.row('n', 'bookcase-wide', walk, r.stairX, 0.05);
      r.grid(-hw + 1.2, -walk, -hd + 1.4, hd, 2.4, 2.8, (x, z) => r.at('bookcase-wide', x, z, 0));
      r.at('lounge-chair', walk + 1.2, hd - 1.2, Math.PI);
      const t = r.at('side-table', walk + 2.4, hd - 1, Math.PI);
      r.on(t, 'lamp-table', 0.55);
      r.counter(walk + 1.2, 3.9, 2.0, Math.PI);
    },
    upper(r) {
      const { hw, hd } = r;
      r.row('w', 'bookcase-wide', -hd + 0.3, hd - 0.3, 0.05);
      r.row('n', 'bookcase-wide', -hw + 0.8, r.stairX, 0.05);
      r.grid(-hw + 1.2, r.stairX - 0.4, -hd + 1.8, hd, 2.6, 2.4, (x, z) => r.dining(x, z));
      r.corners();
    },
  },
  market: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.row('n', 'fridge', -hw + 0.2, -walk - 0.1, 0.02);
      r.row('w', 'bookcase-wide', -hd + 1.2, hd - 0.3, 0.05);
      r.grid(-hw + 1.3, -walk, -hd + 1.8, hd - 1.6, 2.6, 3.2, (x, z) => {
        r.at('bookcase-wide', x, z - 0.32, Math.PI);
        r.at('bookcase-wide', x, z + 0.32, 0);
      });
      r.counter(walk + 1.2, hd - 2.2, 2.2, 0);
      r.counter(walk + 1.2, hd - 4.6, 2.2, 0);
      r.grid(walk, r.stairX, -hd, -3.9, 1.1, 1.1, (x, z) => r.stack(x, z, 1 + Math.floor(r.rand() * 2)));
    },
    upper: (r) => PLANS.warehouse.upper(r),
  },
  hotel: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.counter(-walk - 1.2, -hd + 2.2, 3.2, 0);
      r.wall('n', 'bookcase-wide', -hw + 1.3);
      r.wall('w', 'sofa', hd * 0.35);
      r.wall('w', 'sofa', -hd * 0.05);
      r.at('coffee-table', -hw + 1.7, hd * 0.15, H);
      r.at('coat-rack', walk + 0.5, hd - 0.5);
      r.at('lounge-chair', walk + 1.4, hd * 0.55, -H);
      r.corners();
    },
    upper(r) {
      const { hw, hd } = r;
      // Guest rooms: beds against the west wall, bedside tables, a TV opposite.
      for (let z = -hd + 1.2; z < hd - 1; z += 3) {
        r.bedroom(-hw + 1.1, z, H);
        const t = r.at('side-table', -0.9, z, -H);
        r.on(t, 'tv-vintage', 0.55, { turn: 0 });
      }
      for (const z of [-hd + 1.2, hd - 1.2]) r.bedroom(r.stairX - 1.2, z, -H, 'bed-single');
      r.wall('n', 'sink', 0);
    },
  },
  office: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.counter(-walk - 1.3, hd - 2.4, 2.4, Math.PI);
      r.grid(-hw, -walk, -hd + 0.6, hd - 3.4, 1.9, 2.4, (x, z) => r.desk(x, z));
      r.grid(walk, r.stairX, -hd + 0.6, hd, 1.9, 2.4, (x, z) => r.desk(x, z));
      r.wall('s', 'bench', walk + 1.0);
      r.corners();
    },
    upper(r) {
      const { hw, hd } = r;
      r.row('n', 'bookcase-wide', -hw + 0.2, r.stairX - 0.2, 0.05);
      r.grid(-hw, 0, -hd + 1.2, hd - 3.2, 2.4, 2.9, (x, z) => r.desk(x, z));
      r.dining(-hw * 0.5, hd - 1.6, 'table-cloth');
      const cab = r.wall('e', 'kitchen-cabinet', hd - 1.2);
      r.on(cab, 'coffee-machine', 0.92);
      r.wall('e', 'fridge', hd - 2.3);
      r.grid(0.4, r.stairX, -hd + 1.2, hd - 3.2, 2.4, 2.9, (x, z) => r.desk(x, z, Math.PI, 'laptop'));
      r.corners();
    },
  },
  bank: {
    ground(r) {
      const { hw, hd, walk } = r;
      // Tellers behind one long counter; a vault of boxes behind them; waiting sofas across the hall.
      r.counter(-(hw + walk) / 2, -hd * 0.25, hw - walk - 0.4, 0);
      r.grid(-hw, -walk, -hd, -hd * 0.25 - 1.2, 1, 1, (x, z) => r.stack(x, z, 2));
      r.row('e', 'sofa', 3.9, hd - 0.3);
      r.at('coffee-table', r.stairX - 1.2, hd - 2, -H);
      r.corners();
    },
    upper: (r) => PLANS.office.upper(r),
  },
  clinic: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.counter(-walk - 1.3, -hd + 2, 2.4, 0);
      r.grid(-hw, -walk, -hd + 3.4, hd, 1.9, 1.5, (x, z) => r.at('bench', x, z, Math.PI));
      r.row('e', 'bench', 3.9, hd - 0.3);
      r.wall('n', 'sink', walk + 0.5);
      r.corners();
    },
    upper(r) {
      const { hw, hd } = r;
      // Wards: single beds along both walls with bedside tables, sinks at the end.
      for (let z = -hd + 0.8; z < hd - 0.6; z += 1.9) r.bedroom(-hw + 1.05, z, H, 'bed-single');
      for (let z = -hd + 0.8; z < hd - 0.6; z += 1.9) r.bedroom(r.stairX - 1.05, z, -H, 'bed-single');
      r.wall('n', 'sink', 0);
      r.desk(0, hd - 1.2, Math.PI, 'laptop');
    },
  },
  university: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.row('n', 'bookcase-wide', -hw + 0.2, -walk - 0.2, 0.05);
      r.grid(-hw, -walk, -hd + 2, hd, 2.2, 2.3, (x, z) => r.desk(x, z, Math.PI, 'laptop'));
      r.grid(walk, r.stairX, -hd + 2, hd, 2.2, 2.3, (x, z) => r.desk(x, z, Math.PI, 'laptop'));
    },
    upper(r) {
      const { hw, hd } = r;
      if (r.k % 2) {
        // Library
        r.row('w', 'bookcase-wide', -hd + 0.3, hd - 0.3, 0.05);
        r.grid(-hw + 1.2, -0.4, -hd + 1, hd, 2.4, 2.8, (x, z) => r.at('bookcase-wide', x, z, 0));
        r.grid(0, r.stairX, -hd + 1.2, hd, 2.6, 2.4, (x, z) => r.dining(x, z));
      } else {
        r.desk(0, -hd + 0.8, 0, 'laptop');
        r.row('n', 'bookcase-low', -hw + 0.3, -1.4, 0.05);
        r.grid(-hw, r.stairX, -hd + 2.2, hd, 2.2, 2.3, (x, z) => r.desk(x, z, Math.PI, 'laptop'));
      }
    },
  },
  terminal: {
    ground(r) {
      const { hw, hd, walk } = r;
      for (let t = -hw + 0.3; t < -walk - 2.4; t += 2.9) r.counter(t + 1.2, -hd + 1.3, 2.4, 0);
      r.grid(-hw, -walk, -hd + 3, hd, 2.4, 2.6, (x, z) => r.at('bench', x, z, Math.PI));
      r.grid(walk, r.stairX, -hd, hd, 2.4, 2.6, (x, z) => r.at('bench', x, z, Math.PI));
      const bar = r.wall('s', 'bar', -hw + 1.2);
      r.on(bar, 'coffee-machine', 1.17);
      r.corners();
    },
    upper: (r) => PLANS.office.upper(r),
  },
  mall: {
    ground(r) {
      const { hw, hd, walk } = r;
      // Shop units along both side walls, benches and plants down the aisles.
      r.row('w', ['bookcase-wide', 'fridge', 'bookcase-wide'], -hd + 0.3, hd - 0.3, 0.05);
      r.row('n', ['bookcase-wide', 'fridge'], -hw + 0.7, -walk - 0.2, 0.05);
      r.row('n', ['bookcase-wide', 'fridge'], walk + 0.2, r.stairX - 0.2, 0.05);
      r.counter(-hw + 3, 0, 2.4, H);
      r.counter(r.stairX - 1.2, hd - 2.6, 2.4, 0);
      r.grid(-hw + 4.2, -walk, -hd + 2.6, hd - 1.6, 3.6, 3.2, (x, z, i) => (i % 2 ? r.plant(x, z) : r.at('bench', x, z, H)));
      r.grid(walk, r.stairX - 1, -hd + 2.6, hd - 1.6, 3.6, 3.2, (x, z, i) => (i % 2 ? r.at('bench', x, z, -H) : r.plant(x, z)));
    },
    upper(r) {
      const { hw, hd } = r;
      // Food court
      r.row('n', ['bar', 'bar', 'fridge'], -hw + 0.3, r.stairX - 0.3, 0.05);
      r.grid(-hw, r.stairX, -hd + 2.4, hd, 3.2, 3.2, (x, z) => r.cafeTable(x, z));
      r.row('w', 'bookcase-wide', -hd + 2.4, hd - 0.3, 0.05);
    },
  },
  warehouse: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.row('w', 'bookcase-wide', -hd + 0.3, hd - 0.3, 0.05);
      r.grid(-hw + 1, -walk, -hd + 0.6, hd - 0.6, 1.8, 1.8, (x, z) => r.stack(x, z, 1 + Math.floor(r.rand() * 2)));
      r.grid(walk, r.stairX, -hd + 0.6, hd - 0.6, 1.8, 1.8, (x, z, i) => i % 3 !== 1 && r.stack(x, z));
      r.at('table', walk + 1.4, hd - 1.4, 0);
      r.at('chair', walk + 1.4, hd - 0.7, Math.PI, { collide: false });
    },
    upper(r) {
      const { hw, hd } = r;
      r.row('w', 'bookcase-wide', -hd + 0.3, hd - 0.3, 0.05);
      r.grid(-hw + 1, r.stairX, -hd + 0.6, hd - 2.6, 1.8, 1.8, (x, z, i) => i % 4 !== 3 && r.stack(x, z));
      r.desk(-hw * 0.4, hd - 1.2, Math.PI);
      r.at('radio', -hw * 0.4 + 0.5, hd - 1.2, Math.PI, { y: 0.785 });
    },
  },
  workshop: {
    ground(r) {
      const { hw, hd, walk } = r;
      r.grid(-hw, -walk, -hd + 0.6, hd - 0.6, 2.8, 2.6, (x, z, i) => (i % 3 === 2 ? r.stack(x, z) : r.machine(x, z)));
      r.grid(walk, r.stairX, -hd + 0.6, hd - 0.6, 2.8, 2.6, (x, z, i) => {
        if (i % 2) return r.stack(x, z);
        const t = r.at('table', x, z, 0);
        r.on(t, 'radio', 0.66);
      });
      r.row('w', 'bookcase-wide', -hd + 0.3, hd - 0.3, 0.6);
    },
    upper: (r) => PLANS.warehouse.upper(r),
  },
};

export function furnishBuilding(b, ctx) {
  const plan = PLANS[PURPOSE[b.type]] || PLANS.home;
  b.purpose = PURPOSE[b.type] || 'home';
  for (let k = 0; k <= (b.storeys || 0); k++) {
    const r = room(b, k, ctx);
    (k === 0 ? plan.ground : plan.upper)(r);
  }
}
