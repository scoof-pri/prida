// Inventory, rarity and loot rules shared by the client, the server and tests. No rendering or physics here.
import { WEAPONS, RARITIES, GEAR, MELEE } from './catalog.js';

export { WEAPONS, RARITIES, GEAR, MELEE };
export const SLOT_COUNT = 5; // 0 = melee, 1–4 = weapons
export const MAX_RARITY = RARITIES.length - 1;
const clampInt = (v, a, b, d) => (Number.isInteger(v) && v >= a && v <= b ? v : d);

export function weaponStats(w, r = 0) {
  const base = WEAPONS[w],
    rarity = RARITIES[clampInt(r, 0, MAX_RARITY, 0)];
  return {
    ...base,
    damage: base.damage * rarity.damage,
    reload: (base.reload || 0) * rarity.reload,
    mag: base.melee ? 0 : Math.max(base.mag, Math.round(base.mag * rarity.mag)),
  };
}
export function makeItem(w, r = 0) {
  const s = weaponStats(w, r);
  return { w, r, ammo: s.mag, reserve: WEAPONS[w].melee ? 0 : WEAPONS[w].reserve };
}
export function cloneItem(item) {
  return item ? { ...item } : null;
}

// ---- Pre-match loadout -------------------------------------------------------------------------
export const LOADOUT_CHOICES = {
  melee: MELEE.filter((i) => WEAPONS[i].starter),
  primary: WEAPONS.flatMap((w, i) => (w.starter && w.category === 'primary' ? [i] : [])),
  secondary: WEAPONS.flatMap((w, i) => (w.starter && w.category === 'secondary' ? [i] : [])),
  gear: ['none', ...GEAR.filter((g) => g.starter).map((g) => g.id)],
};
export function defaultLoadout() {
  return { melee: 7, primary: 0, secondary: 2, gear: 'glider' };
}
export function sanitizeLoadout(v) {
  const d = defaultLoadout();
  if (!v || typeof v !== 'object') return d;
  const pick = (key) => (LOADOUT_CHOICES[key].includes(v[key]) ? v[key] : d[key]);
  return { melee: pick('melee'), primary: pick('primary'), secondary: pick('secondary'), gear: pick('gear') };
}
export function encodeLoadout(l) {
  l = sanitizeLoadout(l);
  return [l.melee, l.primary, l.secondary, l.gear].join('.');
}
export function decodeLoadout(text) {
  const [melee, primary, secondary, gear] = String(text || '').split('.');
  return sanitizeLoadout({ melee: +melee, primary: +primary, secondary: +secondary, gear });
}
export function loadoutSlots(l) {
  l = sanitizeLoadout(l);
  return [makeItem(l.melee), makeItem(l.primary), makeItem(l.secondary), null, null];
}
export function makeGear(id) {
  const g = GEAR.find((g) => g.id === id);
  return g ? { id: g.id, fuel: g.fuel ?? 0 } : null;
}

// ---- Loot ----------------------------------------------------------------------------------------
// Rarity weights per chest tier: [common, uncommon, rare, epic, legendary].
export const TIER_WEIGHTS = {
  chest: [42, 31, 17, 8, 2],
  park: [22, 32, 26, 14, 6],
  supply: [8, 22, 34, 25, 11],
};
function weighted(rand, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let n = rand() * total;
  for (let i = 0; i < weights.length; i++) if ((n -= weights[i]) < 0) return i;
  return weights.length - 1;
}
export function rollRarity(rand, tier = 'chest') {
  return weighted(rand, TIER_WEIGHTS[tier] || TIER_WEIGHTS.chest);
}
export function rollWeapon(rand) {
  return weighted(
    rand,
    WEAPONS.map((w) => w.loot || 1),
  );
}
export function rollChest(rand, tier = 'chest', weapon = rollWeapon(rand)) {
  const r = rollRarity(rand, tier);
  // Melee items start one step better so a found blade is worth picking up.
  return {
    loot: { w: weapon, r: WEAPONS[weapon].melee ? Math.min(MAX_RARITY, r + 1) : r },
    medkits: rand() < (tier === 'chest' ? 0.35 : 0.7) ? 1 : 0,
    armor: tier === 'supply' ? 25 : tier === 'park' ? 20 : 15,
    shield: tier === 'supply' ? 40 : tier === 'park' ? 30 : 20,
    gear:
      rand() < (tier === 'supply' ? 0.25 : tier === 'park' ? 0.16 : 0.07)
        ? GEAR[Math.floor(rand() * GEAR.length)].id
        : null,
  };
}

// ---- Inventory -----------------------------------------------------------------------------------
// Adds a found weapon. Returns { slot, dropped, merged } where `dropped` is the item it replaced.
export function addItem(p, item) {
  const w = WEAPONS[item.w];
  if (!w) return { slot: -1, dropped: null };
  if (w.melee) {
    const old = p.slots[0];
    if (old && old.w === item.w && old.r >= item.r) return { slot: 0, dropped: null, merged: true };
    p.slots[0] = { ...item, ammo: 0, reserve: 0 };
    return { slot: 0, dropped: old && old.w !== item.w ? old : null };
  }
  const same = p.slots.findIndex((s, i) => i > 0 && s?.w === item.w);
  if (same > 0) {
    const s = p.slots[same],
      cap = w.reserve * 2;
    if (item.r > s.r) {
      s.r = item.r;
      s.ammo = Math.max(s.ammo, weaponStats(item.w, item.r).mag);
    }
    s.reserve = Math.min(cap, s.reserve + (item.ammo || 0) + Math.ceil(w.reserve * 0.5));
    return { slot: same, dropped: null, merged: true };
  }
  const free = p.slots.findIndex((s, i) => i > 0 && !s);
  if (free > 0) {
    p.slots[free] = { ...item };
    return { slot: free, dropped: null };
  }
  const slot = p.slot > 0 ? p.slot : 1,
    old = p.slots[slot];
  p.slots[slot] = { ...item };
  return { slot, dropped: old };
}
// The most valuable ranged item, used for death drops.
export function bestItem(slots) {
  let best = null;
  for (const s of slots.slice(1))
    if (s && (!best || s.r > best.r || (s.r === best.r && (WEAPONS[s.w].loot || 5) < (WEAPONS[best.w].loot || 5))))
      best = s;
  return best;
}
export function restockAmmo(p, share = 0.4) {
  for (const s of p.slots)
    if (s && !WEAPONS[s.w].melee)
      s.reserve = Math.min(WEAPONS[s.w].reserve * 2, s.reserve + Math.ceil(WEAPONS[s.w].reserve * share));
}
