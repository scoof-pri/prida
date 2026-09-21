// Character levels and the skill tree.
// Coins earned in matches (30 a match, 10 an elimination, 100 a win) buy ranks in two sides: STRENGTH and
// MOBILITY. Every rank bought is one character level. Ten ranks on a side unlock that side's two abilities.
// Every bonus is small and capped, and the server clamps whatever a client claims to the table below.
export const BRANCHES = [
  {
    id: 'strength',
    name: 'STRENGTH',
    color: '#e0a33c',
    nodes: [
      { id: 'blade', name: 'Blade Work', effect: 'melee damage', per: 12, max: 5, cost: 120 },
      { id: 'reload', name: 'Fast Hands', effect: 'reload speed', per: 7, max: 5, cost: 120 },
      { id: 'power', name: 'Firepower', effect: 'weapon damage', per: 3, max: 5, cost: 200 },
      { id: 'armor', name: 'Hard Target', effect: 'damage taken', per: -4, max: 5, cost: 160 },
    ],
    abilities: [
      { id: 'cyber', name: 'CYBER STRIKE', text: '30 % chance that a melee hit kills outright' },
      { id: 'momentum', name: 'MOMENTUM', text: '30 % chance a reload finishes instantly' },
    ],
  },
  {
    id: 'mobility',
    name: 'MOBILITY',
    color: '#7fd6f0',
    nodes: [
      { id: 'speed', name: 'Light Feet', effect: 'movement speed', per: 3, max: 5, cost: 120 },
      { id: 'stamina', name: 'Long Wind', effect: 'sprint drain', per: -6, max: 5, cost: 120 },
      { id: 'recovery', name: 'Second Wind', effect: 'sprint recharge', per: 8, max: 5, cost: 160 },
      { id: 'jump', name: 'Spring Step', effect: 'jump height', per: 5, max: 5, cost: 160 },
    ],
    abilities: [
      { id: 'dash', name: 'DASH', text: 'V (or the DASH button): a burst forward, every 8 s' },
      { id: 'sprintrush', name: 'SECOND WIND+', text: 'sprint recharges 50 % faster' },
    ],
  },
];
export const ABILITY_AT = 10;
export const NODES = BRANCHES.flatMap((b) => b.nodes.map((n) => ({ ...n, branch: b.id })));
export const node = (id) => NODES.find((n) => n.id === id) || null;
// Ranks get dearer as they go: rank k costs cost * (1 + k * 0.6), rounded to ten coins.
export const rankCost = (n, rank) => Math.round((n.cost * (1 + rank * 0.6)) / 10) * 10;

export function cleanSkills(skills) {
  const out = {};
  for (const n of NODES) {
    const v = Math.floor(Number(skills?.[n.id]) || 0);
    if (v > 0) out[n.id] = Math.min(n.max, v);
  }
  return out;
}
export const ranksIn = (skills, branchId) =>
  BRANCHES.find((b) => b.id === branchId).nodes.reduce((sum, n) => sum + (skills?.[n.id] || 0), 0);
export const totalRanks = (skills) => NODES.reduce((sum, n) => sum + (skills?.[n.id] || 0), 0);
export const levelOf = (skills) => 1 + totalRanks(cleanSkills(skills));
export const maxLevel = () => 1 + NODES.reduce((sum, n) => sum + n.max, 0);

// What the simulation actually applies.
export function perks(skills) {
  const s = cleanSkills(skills),
    r = (id) => s[id] || 0,
    strength = ranksIn(s, 'strength') >= ABILITY_AT,
    mobility = ranksIn(s, 'mobility') >= ABILITY_AT;
  return {
    melee: 1 + r('blade') * 0.12,
    reload: 1 / (1 + r('reload') * 0.07),
    damage: 1 + r('power') * 0.03,
    taken: 1 - r('armor') * 0.04,
    speed: 1 + r('speed') * 0.03,
    drain: 1 - r('stamina') * 0.06,
    regen: (1 + r('recovery') * 0.08) * (mobility ? 1.5 : 1),
    jump: 1 + r('jump') * 0.05,
    cyber: strength,
    momentum: strength,
    dash: mobility,
    level: 1 + totalRanks(s),
  };
}
// Perks travel as one short string: one digit per node, in NODES order.
export const packSkills = (skills) => {
  const s = cleanSkills(skills);
  return NODES.map((n) => s[n.id] || 0).join('');
};
export function unpackSkills(text) {
  const out = {};
  const str = String(text || '');
  NODES.forEach((n, i) => {
    const v = Number(str[i]);
    if (Number.isInteger(v) && v > 0) out[n.id] = Math.min(n.max, v);
  });
  return out;
}
// Buying a rank: returns the coins spent, or 0 when it is not affordable or already maxed.
export function buyRank(profile, id) {
  const n = node(id);
  if (!n) return 0;
  profile.skills = cleanSkills(profile.skills);
  const rank = profile.skills[id] || 0;
  if (rank >= n.max) return 0;
  const price = rankCost(n, rank);
  if (profile.coins < price) return 0;
  profile.coins -= price;
  profile.skills[id] = rank + 1;
  profile.level = levelOf(profile.skills);
  return price;
}
