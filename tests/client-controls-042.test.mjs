import test from 'node:test';
import assert from 'node:assert/strict';
import { Predictor, canPredictWalking } from '../src/netcode.js';
import { suitControls } from '../src/suit-controls.js';
import { TechnologySystem, suitMovement } from '../src/technology-system.js';
import { FPV_DRONE, FISTS, WEAPONS } from '../src/catalog.js';
import { makeGear, makeItem } from '../src/items.js';

const map = { limit: { x: 100, z: 100 }, hills: [], obstacles: [], maxTerrainHeight: 0 };
const player = (extra = {}) => ({ id: 'pilot', hp: 100, x: 0, y: 0, z: 0, angle: 0, pitch: 0, vy: 0, stamina: 100, grounded: true, ...extra });

test('ordinary ground walking and grounded AEGIS still predict and reconcile unacknowledged movement', () => {
  for (const gear of [null, makeGear('aegis')]) {
    const p = player({ gear }), predictor = new Predictor();
    assert.equal(canPredictWalking(p), true);
    predictor.server(p, 0, map, {});
    const seq = predictor.record({ z: 1 }, .1);
    assert.ok(Math.abs(predictor.position(p, map, {}, 1 / 60).z - .58) < 1e-8);
    const confirmed = { ...p, z: .58 };
    predictor.server(confirmed, seq, map, {});
    assert.equal(predictor.pending.length, 0);
    assert.ok(Math.abs(predictor.position(confirmed, map, {}, 1 / 60).z - confirmed.z) < 1e-8);
  }
});

test('FPV control, airborne AEGIS and its coast never replay movement as walking', () => {
  const cases = [
    { name: 'FPV operator', droneId: 'drone-1' },
    { name: 'powered suit', gear: makeGear('aegis'), grounded: false, suitFlight: true, suitVZ: 22 },
    { name: 'coasting suit', gear: makeGear('aegis'), grounded: false, suitFlight: false, suitVZ: 18 },
    { name: 'falling suit', gear: makeGear('aegis'), grounded: false, suitFlight: false, suitVZ: 0 },
    { name: 'suit landing with remaining inertia', gear: makeGear('aegis'), grounded: true, suitVZ: 4 },
  ];
  for (const state of cases) {
    const walking = player(), special = player(state), predictor = new Predictor();
    predictor.server(walking, 0, map, {});
    const seq = predictor.record({ z: 1, sprint: true }, .1);
    assert.equal(canPredictWalking(special), false, state.name);
    assert.equal(predictor.raw(special, map, {}), null, state.name);
    assert.equal(predictor.position(special, map, {}, 1 / 60), null, state.name);
    predictor.server(special, seq, map, {});
    assert.equal(predictor.base, null, state.name);
    assert.deepEqual(predictor.error, { x: 0, z: 0 });
    assert.equal(special.z, 0, 'the authoritative operator/suit position remains untouched');
  }
});

test('walking resumes from the acknowledged position without replaying old FPV commands', () => {
  const p = player({ droneId: 'drone-1', z: 6 }), predictor = new Predictor();
  predictor.server(p, 0, map, {});
  predictor.record({ z: 1 }, .1);
  const lastDroneCommand = predictor.record({ z: 1 }, .1);
  assert.equal(predictor.position(p, map, {}, 1 / 60), null);
  const walking = { ...p, droneId: null };
  predictor.server(walking, lastDroneCommand, map, {});
  assert.equal(predictor.position(walking, map, {}, 1 / 60).z, 6);
  predictor.record({ z: 1 }, .1);
  assert.ok(Math.abs(predictor.position(walking, map, {}, 1 / 60).z - 6.58) < 1e-8);
});

test('DOWN requests powered descent only in the air, while UP still starts takeoff', () => {
  const p = player({ gear: makeGear('aegis') });
  const a = { map, events: [] }, system = new TechnologySystem(a), dt = 1 / 60;
  const downInput = () => ({ suitThrust: suitControls(p, { down: true }).thrust, ascend: -1 });
  system.playerStep(p, downInput(), dt);
  assert.equal(p.suitFlight, false);
  assert.equal(p.grounded, true);
  assert.equal(a.events.length, 0, 'DOWN on the ground cannot trigger takeoff');
  assert.equal(suitControls(p, { up: true }).thrust, true);
  Object.assign(p, { grounded: false, y: 10, suitSpool: 1 });
  const descending = downInput(), fuel = p.gear.fuel;
  assert.equal(descending.suitThrust, true);
  system.playerStep(p, descending, dt);
  p.vy -= 22 * dt;
  suitMovement(p, descending, dt);
  assert.equal(p.suitFlight, true);
  assert.ok(p.vy < 0);
  assert.ok(p.gear.fuel < fuel, 'the powered descent uses the same finite energy');
  p.grounded = true;
  assert.equal(downInput().suitThrust, false, 'landing while holding DOWN cannot start another takeoff');
});

test('selected FPV stows suit weapons without disabling flight, including a pending slot change', () => {
  const gun = WEAPONS.findIndex(w => !w.melee && !w.consumable);
  const p = player({ gear: makeGear('aegis'), slot: 1, weapon: gun, slots: [makeItem(FISTS), makeItem(gun), makeItem(FPV_DRONE)] });
  assert.equal(suitControls(p).suitWeapons, true);
  const drone = suitControls(p, { slot: 2, up: true });
  assert.equal(drone.drone, true);
  assert.equal(drone.suitWeapons, false);
  assert.equal(drone.thrust, true);
  Object.assign(p, { weapon: FPV_DRONE, slot: 2 });
  assert.equal(suitControls(p, { slot: 1 }).suitWeapons, true, 'switching away from FPV uses the requested slot immediately');
  p.droneId = 'active-drone';
  const linked = suitControls(p, { slot: 1, up: true });
  assert.equal(linked.suitWeapons, false);
  assert.equal(linked.thrust, false);
});
