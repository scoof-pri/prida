// Wardrobe, wallet and battle pass.
// Everything here is cosmetic: colours, patterns, charms, accessories, effects and emotes never change how
// much damage anyone does. Items are bought with coins earned in matches, or unlocked by battle-pass tiers.
import { defaultLoadout, sanitizeLoadout } from './items.js';

// kind: what slot an item fills. price: coins in the shop; `pass` items are only won on the battle pass.
export const COSMETICS = [
  // ——— Weapon colours ———
  { id: 'standard', name: 'Field Issue', kind: 'finish', price: 0, color: '#ffffff' },
  { id: 'ember', name: 'Ember', kind: 'finish', price: 100, color: '#ff9c6c' },
  { id: 'glacier', name: 'Glacier', kind: 'finish', price: 100, color: '#8edbff' },
  { id: 'jade', name: 'Jade', kind: 'finish', price: 150, color: '#82f0bc' },
  { id: 'violet', name: 'Violet', kind: 'finish', price: 150, color: '#c5a0ff' },
  { id: 'gold', name: 'Gold Rush', kind: 'finish', price: 300, color: '#ffcf68' },
  { id: 'crimson', name: 'Crimson', kind: 'finish', pass: true, color: '#ff6f7a' },
  { id: 'abyss', name: 'Abyss', kind: 'finish', pass: true, color: '#6f7dff' },
  { id: 'acid', name: 'Acid', kind: 'finish', pass: true, color: '#c9ff5e' },
  // ——— Weapon patterns ———
  { id: 'nopattern', name: 'No Pattern', kind: 'pattern', price: 0, color: '#9aa7a3' },
  { id: 'stripes', name: 'Stripes', kind: 'pattern', price: 120, color: '#ffd27a' },
  { id: 'carbon', name: 'Carbon', kind: 'pattern', price: 180, color: '#4a5257' },
  { id: 'camo', name: 'Camo', kind: 'pattern', price: 180, color: '#7d8f5c' },
  { id: 'neon', name: 'Neon', kind: 'pattern', pass: true, color: '#59ffe0' },
  { id: 'tiger', name: 'Tiger', kind: 'pattern', pass: true, color: '#ffa32e' },
  // ——— Weapon charms (they dangle off the grip) ———
  { id: 'nocharm', name: 'No Charm', kind: 'charm', price: 0, color: '#9aa7a3' },
  { id: 'cube', name: 'Lucky Cube', kind: 'charm', price: 80, color: '#ffd166' },
  { id: 'skull', name: 'Skull', kind: 'charm', price: 140, color: '#eae3d2' },
  { id: 'star', name: 'Star', kind: 'charm', price: 140, color: '#ffe066' },
  { id: 'bell', name: 'Bell', kind: 'charm', pass: true, color: '#ffc14d' },
  { id: 'shard', name: 'Chaos Bit', kind: 'charm', pass: true, color: '#38e0b0' },
  // ——— Player skins ———
  { id: 'soldier', name: 'Ranger', kind: 'operator', price: 0, color: '#bdd0ab', model: 0 },
  { id: 'hazmat', name: 'Hazmat', kind: 'operator', price: 200, color: '#e8c672', model: 1 },
  { id: 'scout', name: 'Outrider', kind: 'operator', price: 250, color: '#a0bfe0', model: 2 },
  { id: 'nightranger', name: 'Night Ranger', kind: 'operator', price: 350, color: '#54617a', model: 0, skin: '#5b6880' },
  { id: 'sandscout', name: 'Dune Outrider', kind: 'operator', pass: true, color: '#d9b782', model: 2, skin: '#d9b782' },
  { id: 'toxicsuit', name: 'Toxic Suit', kind: 'operator', pass: true, color: '#9ff06a', model: 1, skin: '#8fe05c' },
  { id: 'titan', name: 'Titan', kind: 'operator', pass: true, color: '#e0a33c', model: 0, skin: '#e0a33c' },
  // ——— Accessories (worn on the head) ———
  { id: 'noaccessory', name: 'Nothing', kind: 'accessory', price: 0, color: '#9aa7a3' },
  { id: 'cap', name: 'Cap', kind: 'accessory', price: 90, color: '#5f8f6a' },
  { id: 'visor', name: 'Visor', kind: 'accessory', price: 150, color: '#7ad0ff' },
  { id: 'antenna', name: 'Antenna', kind: 'accessory', price: 150, color: '#e2e6dd' },
  { id: 'horns', name: 'Horns', kind: 'accessory', pass: true, color: '#d86b4a' },
  { id: 'halo', name: 'Halo', kind: 'accessory', pass: true, color: '#ffe9a3' },
  // ——— Effects (what follows you around) ———
  { id: 'noeffect', name: 'None', kind: 'effect', price: 0, color: '#9aa7a3' },
  { id: 'dust', name: 'Dust Trail', kind: 'effect', price: 120, color: '#cfc4ad' },
  { id: 'sparks', name: 'Sparks', kind: 'effect', price: 200, color: '#ffc14d' },
  { id: 'aura', name: 'Jade Aura', kind: 'effect', pass: true, color: '#82f0bc' },
  { id: 'embers', name: 'Embers', kind: 'effect', pass: true, color: '#ff7a3c' },
  // ——— Emotes (B, or the EMOTE button on touch) ———
  { id: 'wave', name: 'Wave', kind: 'emote', price: 0, color: '#e6d3a8', clip: 'Wave' },
  { id: 'yes', name: 'Nod', kind: 'emote', price: 60, color: '#e6d3a8', clip: 'Yes' },
  { id: 'no', name: 'Shake Head', kind: 'emote', price: 60, color: '#e6d3a8', clip: 'No' },
  { id: 'crouchdance', name: 'Squat Dance', kind: 'emote', price: 180, color: '#ffb570', clip: 'Duck', dance: { bob: 0.22, speed: 7 } },
  { id: 'spindance', name: 'Spin Dance', kind: 'emote', pass: true, color: '#ff8fb0', clip: 'Wave', dance: { spin: 5.5, bob: 0.12, speed: 9 } },
  { id: 'robot', name: 'Robot', kind: 'emote', pass: true, color: '#9fe3ff', clip: 'Walk', dance: { step: 3, bob: 0.06, speed: 1.4 } },
  { id: 'jumpjack', name: 'Jump Jacks', kind: 'emote', pass: true, color: '#c9ff5e', clip: 'Jump_Idle', dance: { bob: 0.34, speed: 5 } },
];
export const KINDS = ['operator', 'accessory', 'finish', 'pattern', 'charm', 'effect', 'emote'];
const DEFAULTS = {
  operator: 'soldier',
  accessory: 'noaccessory',
  finish: 'standard',
  pattern: 'nopattern',
  charm: 'nocharm',
  effect: 'noeffect',
  emote: 'wave',
};
export const item = (id) => COSMETICS.find((c) => c.id === id) || null;
export const itemsOfKind = (kind) => COSMETICS.filter((c) => c.kind === kind);

// Battle pass: 30 tiers, one reward each, earned by playing. No payment, no premium track.
export const PASS_TIER_XP = 250;
export const PASS_TIERS = [
  'crimson', 'cube', 'stripes', 'cap', 'yes', 'neon', 'bell', 'abyss', 'crouchdance', 'sandscout',
  'camo', 'skull', 'visor', 'no', 'tiger', 'aura', 'star', 'acid', 'spindance', 'toxicsuit',
  'carbon', 'horns', 'embers', 'robot', 'shard', 'antenna', 'halo', 'jumpjack', 'nightranger', 'titan',
];
export const passTier = (xp) => Math.min(PASS_TIERS.length, Math.floor(Math.max(0, xp) / PASS_TIER_XP));

// A full, valid appearance. Accepts an object of ids or a packed string (what travels over the network).
export function appearance(value = {}) {
  const v = typeof value === 'string' ? unpack(value) : value || {},
    out = {};
  for (const kind of KINDS) {
    const found = item(v[kind]);
    out[kind] = found && found.kind === kind ? found.id : DEFAULTS[kind];
  }
  out.tint = Number.isInteger(v.tint) ? v.tint : undefined;
  return out;
}
// Packed form: the index of each item in COSMETICS, dot separated, then the bot tint. Short enough to ride
// along in every state packet.
export function pack(value = {}) {
  const a = appearance(value);
  return KINDS.map((k) => COSMETICS.findIndex((c) => c.id === a[k])).join('.') + '.' + (a.tint ?? '');
}
function unpack(text) {
  const parts = String(text).split('.'),
    out = {};
  KINDS.forEach((k, i) => {
    const c = COSMETICS[Number(parts[i])];
    if (c && c.kind === k) out[k] = c.id;
  });
  const tint = Number(parts[KINDS.length]);
  if (parts[KINDS.length] !== '' && Number.isInteger(tint)) out.tint = tint;
  return out;
}

export function freshProfile() {
  return {
    version: 2,
    coins: 350,
    owned: Object.values(DEFAULTS),
    equipped: appearance(),
    loadout: defaultLoadout(),
    matches: 0,
    wins: 0,
    kills: 0,
    passXp: 0,
    passTier: 0,
    // Stage 4 (levels and the skill tree) keeps its own numbers here.
    level: 1,
    xp: 0,
    skills: {},
  };
}
export function readProfile(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || (v.version !== 1 && v.version !== 2)) return freshProfile();
    const p = freshProfile();
    p.coins = Number.isSafeInteger(v.coins) && v.coins >= 0 ? Math.min(v.coins, 1e7) : 350;
    p.owned = [...new Set([...p.owned, ...(Array.isArray(v.owned) ? v.owned : []).filter((id) => !!item(id))])];
    p.equipped = appearance(v.equipped);
    p.loadout = sanitizeLoadout(v.loadout);
    for (const k of KINDS) if (!p.owned.includes(p.equipped[k])) p.equipped[k] = DEFAULTS[k];
    for (const k of ['matches', 'wins', 'kills', 'passXp', 'level', 'xp'])
      p[k] = Number.isSafeInteger(v[k]) && v[k] >= 0 ? v[k] : p[k];
    p.passTier = passTier(p.passXp);
    if (v.skills && typeof v.skills === 'object') p.skills = { ...v.skills };
    return p;
  } catch {
    return freshProfile();
  }
}
export function buyOrEquip(p, id) {
  const it = item(id);
  if (!it) return false;
  if (!p.owned.includes(id)) {
    if (it.pass || !(p.coins >= it.price)) return false;
    p.coins -= it.price;
    p.owned.push(id);
  }
  p.equipped[it.kind] = id;
  return true;
}
// Match rewards: coins for the wallet and battle-pass progress. Returns what was earned and any new tiers.
export function rewardMatch(p, { kills = 0, win = false, cheated = false, seconds = 0 } = {}) {
  if (cheated || seconds < 20) return { coins: 0, xp: 0, unlocked: [] };
  kills = Math.min(50, Math.max(0, Math.floor(kills)));
  const coins = 30 + kills * 10 + (win ? 100 : 0),
    xp = 60 + kills * 25 + (win ? 200 : 0);
  p.coins += coins;
  p.matches++;
  p.wins += win ? 1 : 0;
  p.kills += kills;
  return { coins, xp, ...addPassXp(p, xp) };
}
// Battle-pass tiers hand their reward over as soon as they are reached.
export function addPassXp(p, xp) {
  const before = passTier(p.passXp);
  p.passXp = Math.min(PASS_TIERS.length * PASS_TIER_XP, (p.passXp || 0) + Math.max(0, xp));
  const after = passTier(p.passXp),
    unlocked = [];
  for (let t = before; t < after; t++) {
    const id = PASS_TIERS[t];
    if (id && !p.owned.includes(id)) {
      p.owned.push(id);
      unlocked.push(id);
    }
  }
  p.passTier = after;
  return { unlocked, tier: after };
}
