import { defaultLoadout, sanitizeLoadout } from './items.js';
export const COSMETICS = [
  { id: 'standard', name: 'Field Issue', kind: 'finish', price: 0, color: '#ffffff' },
  { id: 'ember', name: 'Ember', kind: 'finish', price: 100, color: '#ff9c6c' },
  { id: 'glacier', name: 'Glacier', kind: 'finish', price: 100, color: '#8edbff' },
  { id: 'jade', name: 'Jade', kind: 'finish', price: 150, color: '#82f0bc' },
  { id: 'violet', name: 'Violet', kind: 'finish', price: 150, color: '#c5a0ff' },
  { id: 'gold', name: 'Gold Rush', kind: 'finish', price: 300, color: '#ffcf68' },
  { id: 'soldier', name: 'Ranger', kind: 'operator', price: 0, color: '#bdd0ab', model: 0 },
  { id: 'hazmat', name: 'Hazmat', kind: 'operator', price: 200, color: '#e8c672', model: 1 },
  { id: 'scout', name: 'Outrider', kind: 'operator', price: 250, color: '#a0bfe0', model: 2 },
];
export function appearance(value = {}) {
  return {
    finish: COSMETICS.find((c) => c.id === value.finish && c.kind === 'finish')?.id || 'standard',
    operator: COSMETICS.find((c) => c.id === value.operator && c.kind === 'operator')?.id || 'soldier',
  };
}
export function freshProfile() {
  return {
    version: 1,
    coins: 350,
    owned: ['standard', 'soldier'],
    equipped: appearance(),
    loadout: defaultLoadout(),
    matches: 0,
    wins: 0,
    kills: 0,
  };
}
export function readProfile(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || v.version !== 1) return freshProfile();
    const p = freshProfile();
    p.coins = Number.isSafeInteger(v.coins) && v.coins >= 0 ? Math.min(v.coins, 1e7) : 350;
    p.owned = [
      ...new Set([
        ...p.owned,
        ...(Array.isArray(v.owned) ? v.owned : []).filter((id) => COSMETICS.some((c) => c.id === id)),
      ]),
    ];
    p.equipped = appearance(v.equipped);
    p.loadout = sanitizeLoadout(v.loadout);
    for (const k of ['finish', 'operator'])
      if (!p.owned.includes(p.equipped[k])) p.equipped[k] = freshProfile().equipped[k];
    for (const k of ['matches', 'wins', 'kills']) p[k] = Number.isSafeInteger(v[k]) && v[k] >= 0 ? v[k] : 0;
    return p;
  } catch {
    return freshProfile();
  }
}
export function buyOrEquip(p, id) {
  const item = COSMETICS.find((c) => c.id === id);
  if (!item) return false;
  if (!p.owned.includes(id)) {
    if (p.coins < item.price) return false;
    p.coins -= item.price;
    p.owned.push(id);
  }
  p.equipped[item.kind] = id;
  return true;
}
export function rewardMatch(p, { kills = 0, win = false, cheated = false, seconds = 0 } = {}) {
  if (cheated || seconds < 20) return 0;
  kills = Math.min(50, Math.max(0, Math.floor(kills)));
  const coins = 30 + kills * 10 + (win ? 100 : 0);
  p.coins += coins;
  p.matches++;
  p.wins += win ? 1 : 0;
  p.kills += kills;
  return coins;
}
