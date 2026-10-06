// FPV drones are finite consumable inventory items. Slots are the only authority;
// no client field or legacy counter can manufacture a drone.
import { FPV_DRONE, WEAPONS } from './catalog.js';
import { addItem, makeItem } from './items.js';

export const MAX_CARRIED_FPV = 5;
export function fpvCount(player) {
  return (player?.slots || []).reduce((sum, item, i) =>
    sum + (i > 0 && item?.w === FPV_DRONE && Number.isInteger(item.ammo)
      ? Math.max(0, Math.min(MAX_CARRIED_FPV, item.ammo)) : 0), 0);
}
export function fpvSlot(player, selectedOnly = false) {
  const valid = i => i > 0 && player?.slots?.[i]?.w === FPV_DRONE &&
    Number.isInteger(player.slots[i].ammo) && player.slots[i].ammo > 0 && player.slots[i].ammo <= MAX_CARRIED_FPV;
  if (valid(player?.slot)) return player.slot;
  return selectedOnly ? -1 : (player?.slots || []).findIndex((_, i) => valid(i));
}
export function receiveFPV(player, item = makeItem(FPV_DRONE)) {
  if (item?.w !== FPV_DRONE || !Number.isInteger(item.ammo) || item.ammo <= 0)
    return { slot: -1, dropped: null, taken: 0, remaining: 0 };
  const taken = Math.min(item.ammo, Math.max(0, MAX_CARRIED_FPV - fpvCount(player)));
  if (!taken) return { slot: -1, dropped: null, full: true, taken: 0, remaining: item.ammo };
  const result = addItem(player, { ...item, ammo: taken, reserve: 0 });
  return { ...result, taken, remaining: item.ammo - taken };
}
export function consumeFPV(player, slot) {
  const item = player?.slots?.[slot];
  if (slot <= 0 || item?.w !== FPV_DRONE || !Number.isInteger(item.ammo) || item.ammo <= 0 || item.ammo > MAX_CARRIED_FPV) return false;
  item.ammo--;
  if (item.ammo === 0) {
    player.slots[slot] = null;
    if (player.slot === slot) player.slot = 0;
  }
  return true;
}
export function isFPV(item) { return !!item && !!WEAPONS[item.w]?.drone; }
