// Inventory, rarity and loot rules shared by the client, the server and tests. No rendering or physics here.
import { WEAPONS, RARITIES, GEAR, MELEE, ARMOR_TIERS, FISTS } from './catalog.js';

export { WEAPONS, RARITIES, GEAR, MELEE, ARMOR_TIERS, FISTS };
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
    mag: base.melee ? 0 : base.consumable ? base.mag : Math.max(base.mag, Math.round(base.mag * rarity.mag)),
  };
}
// An item as it sits in a slot. Items (consumables, deployables, the new throwables) have one fixed rarity; a
// consumable found in a chest comes as a small stack (`found`), not a full slot.
export function makeItem(w, r = 0) {
  const base = WEAPONS[w];
  if (base.rarity !== undefined) r = base.rarity;
  const s = weaponStats(w, r);
  return { w, r, ammo: base.consumable ? base.found || 1 : s.mag, reserve: base.melee || base.consumable ? 0 : base.reserve };
}
// What everyone starts a life with since 0.27: bare hands, nothing else.
export function startSlots() {
  return [makeItem(FISTS), null, null, null, null];
}
export const isItem = (w) => !!WEAPONS[w]?.consumable;
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
  return g ? { id: g.id, fuel: g.fuel ?? 0, hp: g.hp ?? 0 } : null;
}
// How much the shield and a heavy vest slow a player down.
export function carryWeight(p) {
  const shield = p.gear?.id === 'shield' && p.gear.hp > 0 ? GEAR.find((g) => g.id === 'shield').slow : 1,
    vest = p.armorTier ? ARMOR_TIERS.find((a) => a.id === p.armorTier)?.slow || 1 : 1;
  return shield * vest;
}
// Picking up body armour: plates add to the bar and the better vest is the one you keep.
export function wearArmor(p, tier) {
  const a = ARMOR_TIERS.find((q) => q.id === tier);
  if (!a) return false;
  p.armor = Math.min(100, p.armor + a.points);
  const now = ARMOR_TIERS.findIndex((q) => q.id === p.armorTier),
    next = ARMOR_TIERS.findIndex((q) => q.id === tier);
  if (next > now) p.armorTier = tier;
  return true;
}

// ---- Loot ----------------------------------------------------------------------------------------
// Rarity weights per chest tier: [common, uncommon, rare, epic, legendary].
// Chest tiers (0.27): 'chest' by a door, 'park' in parks and the wild, 'supply' crates on the avenue, 'roof' on flat
// roofs and 'legendary' on the tallest ones. Weights per rarity: common, uncommon, rare, epic, legendary.
export const TIER_WEIGHTS = {
  chest: [42, 31, 17, 8, 2],
  park: [22, 32, 26, 14, 6],
  supply: [8, 22, 34, 25, 11],
  roof: [4, 16, 36, 31, 13],
  legendary: [0, 0, 14, 44, 42],
};
// Better tiers carry more: medkit, armour, plate, gear and item chances. Armour mostly comes from shield items
// since 0.27, so chests hand out less of it directly.
const TIER_EXTRAS = {
  chest: { medkit: 0.25, armor: 0, plate: 0.12, heavy: 0.04, gear: 0.07, item: 0.6 },
  park: { medkit: 0.45, armor: 0, plate: 0.2, heavy: 0.05, gear: 0.16, item: 0.75 },
  supply: { medkit: 0.6, armor: 10, plate: 0.35, heavy: 0.15, gear: 0.25, item: 0.9 },
  roof: { medkit: 0.7, armor: 10, plate: 0.45, heavy: 0.2, gear: 0.3, item: 0.95 },
  legendary: { medkit: 1, armor: 25, plate: 0.85, heavy: 0.55, gear: 0.5, item: 1 },
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
// The weapons a chest can hold as its main find (no bare hands, no items), and the items it adds on top.
export const LOOT_WEAPONS = WEAPONS.flatMap((w, i) => (!w.noLoot && !w.consumable && !w.extra ? [i] : []));
export const EXTRA_ITEMS = WEAPONS.flatMap((w, i) => (w.consumable || w.extra ? [i] : []));
export function rollWeapon(rand) {
  return LOOT_WEAPONS[weighted(
    rand,
    LOOT_WEAPONS.map((i) => WEAPONS[i].loot || 1),
  )];
}
export function rollExtra(rand) {
  return EXTRA_ITEMS[weighted(
    rand,
    EXTRA_ITEMS.map((i) => WEAPONS[i].loot || 1),
  )];
}
export function rollChest(rand, tier = 'chest', weapon = rollWeapon(rand)) {
  const r = rollRarity(rand, tier);
  // Melee items start one step better so a found blade is worth picking up.
  // Body armour: a plate carrier in better chests, a light vest in ordinary ones.
  const plateRoll = rand();
  const x = TIER_EXTRAS[tier] || TIER_EXTRAS.chest;
  const w = WEAPONS[weapon];
  // Since 0.27 a chest also holds an item: shields, heals, a throwable or something to set down.
  const extra = rand() < x.item ? rollExtra(rand) : null;
  return {
    loot: { w: weapon, r: w.rarity ?? (w.melee ? Math.min(MAX_RARITY, r + 1) : r) },
    extra: extra === null ? null : { w: extra, r: WEAPONS[extra].rarity ?? 0 },
    medkits: rand() < x.medkit ? 1 : 0,
    armor: x.armor,
    plate: plateRoll < x.plate ? (plateRoll < x.heavy ? 'heavy' : 'light') : null,
    gear: rand() < x.gear ? GEAR[Math.floor(rand() * GEAR.length)].id : null,
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
    // Bare hands are never left lying on the ground.
    return { slot: 0, dropped: old && old.w !== item.w && !WEAPONS[old.w].fists ? old : null };
  }
  // Items stack in their slot up to `mag`; what does not fit goes on to a free slot like a new find.
  if (w.consumable) {
    let left = item.ammo || w.found || 1;
    for (let i = 1; i < p.slots.length && left > 0; i++) {
      const s = p.slots[i];
      if (s?.w !== item.w || s.ammo >= w.mag) continue;
      const put = Math.min(left, w.mag - s.ammo);
      s.ammo += put;
      left -= put;
      if (!left) return { slot: i, dropped: null, merged: true };
    }
    item = { ...item, ammo: left };
  }
  const same = w.consumable ? -1 : p.slots.findIndex((s, i) => i > 0 && s?.w === item.w);
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
// The most valuable ranged item.
export function bestItem(slots) {
  let best = null;
  for (const s of slots.slice(1).filter((s) => s && !WEAPONS[s.w].consumable))
    if (s && (!best || s.r > best.r || (s.r === best.r && (WEAPONS[s.w].loot || 5) < (WEAPONS[best.w].loot || 5))))
      best = s;
  return best;
}
export function restockAmmo(p, share = 0.4) {
  for (const s of p.slots)
    if (s && !WEAPONS[s.w].melee && !WEAPONS[s.w].consumable)
      s.reserve = Math.min(WEAPONS[s.w].reserve * 2, s.reserve + Math.ceil(WEAPONS[s.w].reserve * share));
}
