import { WEAPONS } from './catalog.js';

// One control mode for keyboard, touch and HUD. Use the requested inventory slot
// so a slot change and fire command agree before the next server state arrives.
export function suitControls(p, { slot = p?.slot, up = false, down = false } = {}) {
  const drone = !!WEAPONS[p?.slots?.[slot]?.w ?? p?.weapon]?.drone;
  const suit = p?.gear?.id === 'aegis' && p.hp > 0 && !p.inBus && !p.vehicle && !p.droneId;
  return {
    suit,
    drone,
    suitWeapons: suit && !drone,
    // DOWN is a powered descent in the air, never a takeoff command on the ground.
    thrust: suit && (!!up || (!!down && p.grounded === false)),
  };
}
