// User supplied FBX motions, retargeted offline to the tactical and AEGIS rigs.
// The GLBs retain the originals; aliases and upper/lower body combinations are created once at load.
import * as T from 'three';
import { WEAPONS, RARITIES } from './catalog.js';

export const IMPORTED_ANIMATION_SOURCES = Object.freeze({
  Idle: 'Adventure_idle_2', Idle_Gun: 'Rifle_Aiming_Idle', Idle_Shoot: 'Firing_Rifle',
  Walk: 'Adventure_walking', Run: 'Adventure_running', Sprint: 'Adventure_running',
  Jump: 'Adventure_jumping_up', Jump_Start: 'Adventure_jumping_up', Jump_Idle: 'Adventure_falling_idle',
  Jump_Land: 'Adventure_hard_landing', Roll: 'Adventure_falling_to_roll',
  Death: 'Death', Reload: 'Reload', Slash: 'Dagger_Stab', DropKick: 'DropKick',
  Walk_Backward: 'Walk_Backward', Strafe_Start_Left: 'Strafing',
  Strafe_Left: 'Adventure_crouched_sneaking_left', Strafe_Right: 'Adventure_crouched_sneaking_right',
  Turn_Left: 'Adventure_left_turn', Turn_Right: 'Adventure_right_turn', Run_Stop: 'Adventure_run_to_stop',
  Duck: 'Adventure_idle_4', Crouch_Walk: 'Adventure_crouched_sneaking_left',
  Cover_Left: 'Adventure_left_cover_sneak', Cover_Right: 'Adventure_right_cover_sneak',
  Cover_Enter: 'Adventure_stand_to_cover', Cover_Exit: 'Adventure_cover_to_stand_2',
  Heal: 'Adventure_idle_4', Use: 'Adventure_stand_to_cover_2', Loot: 'Adventure_stand_to_cover_2',
});
const UPPER = new Set(['Abdomen', 'Torso', 'Neck', 'Head', 'UpperArmL', 'LowerArmL', 'HandL', 'UpperArmR', 'LowerArmR', 'HandR']);
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, finite(n)));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const boneOf = (track) => track.name.slice(0, track.name.lastIndexOf('.'));
const cloneAs = (clip, name) => { const c = clip.clone(); c.name = name; return c; };

// Mirroring reflects rotation about the sagittal plane and exchanges left/right bone tracks.
// It does not reverse time: foot contacts and gravity remain in their original order.
function mirror(clip, name) {
  const out = cloneAs(clip, name);
  for (const t of out.tracks) {
    const bone = boneOf(t), side = /[LR]$/.test(bone) ? bone.slice(-1) : null;
    if (side) t.name = bone.slice(0, -1) + (side === 'L' ? 'R' : 'L') + t.name.slice(bone.length);
    const q = t.name.endsWith('.quaternion');
    for (let i = 0; i < t.values.length; i += q ? 4 : 3) {
      if (q) { t.values[i + 1] *= -1; t.values[i + 2] *= -1; }
      else t.values[i] *= -1;
    }
  }
  return out;
}

// Keep locomotion on the hips/legs and rifle handling on the upper body. Correct the abdomen
// against the lower clip's hip rotation, so the rifle does not inherit a sideways aiming stance.
export function combineUpperBody(lower, upper, name, duration = lower.duration) {
  const lowerTracks = new Map(lower.tracks.map(t => [t.name, t.createInterpolant()]));
  const upperTracks = new Map(upper.tracks.map(t => [t.name, t.createInterpolant()]));
  const frames = Math.max(2, Math.ceil(duration * 30) + 1);
  const times = Float32Array.from({ length: frames }, (_, i) => i * duration / (frames - 1));
  const q = new T.Quaternion(), hip = new T.Quaternion(), upperHip = new T.Quaternion();
  const tracks = lower.tracks.map(t => {
    const upperBone = UPPER.has(boneOf(t)), interpolant = (upperBone ? upperTracks : lowerTracks).get(t.name);
    if (!interpolant) return t.clone();
    const stride = t.getValueSize(), values = new Float32Array(frames * stride);
    for (let i = 0; i < frames; i++) {
      const lt = duration === lower.duration ? times[i] : times[i] % lower.duration;
      const ut = times[i] / duration * upper.duration;
      const value = interpolant.evaluate(upperBone ? ut : lt);
      if (t.name === 'Abdomen.quaternion') {
        hip.fromArray(lowerTracks.get('Hips.quaternion').evaluate(lt)).invert();
        upperHip.fromArray(upperTracks.get('Hips.quaternion').evaluate(ut));
        q.fromArray(value).premultiply(upperHip).premultiply(hip).normalize().toArray(values, i * stride);
      } else values.set(value, i * stride);
    }
    return new t.constructor(t.name, times, values, t.getInterpolation());
  });
  return new T.AnimationClip(name, duration, tracks).optimize();
}

export function prepareImportedClips(originals, fallback) {
  const source = new Map((originals || []).map(c => [c.name, c]));
  if (!source.has('Rifle_Aiming_Idle') || !source.has('Adventure_walking')) return { clips: fallback, imported: false };
  const output = new Map(fallback.map(c => [c.name, c]));
  for (const c of source.values()) output.set(c.name, c);
  for (const [alias, key] of Object.entries(IMPORTED_ANIMATION_SOURCES)) {
    const c = source.get(key); if (c) output.set(alias, alias === key ? c : cloneAs(c, alias));
  }
  output.set('Strafe_Start_Right', mirror(source.get('Strafing'), 'Strafe_Start_Right'));
  for (const base of ['Walk', 'Run', 'Walk_Backward', 'Strafe_Left', 'Strafe_Right', 'Strafe_Start_Left', 'Strafe_Start_Right', 'Run_Stop']) {
    const lower = output.get(base);
    output.set(base + '_Gun', combineUpperBody(lower, source.get('Rifle_Aiming_Idle'), base + '_Gun'));
    output.set(base + '_Shoot', combineUpperBody(lower, source.get('Firing_Rifle'), base + '_Shoot'));
  }
  for (const base of ['Walk', 'Run']) output.set('Reload_' + base, combineUpperBody(output.get(base), source.get('Reload'), 'Reload_' + base, source.get('Reload').duration));
  // Fist jabs remain the game-authored guard/punch; blade attacks and alternate fist kicks use supplied motion.
  if (output.has('Punch')) output.set('Jab', cloneAs(output.get('Punch'), 'Jab'));
  return { clips: [...output.values()], imported: true };
}

export const importedMelee = name => ['DropKick', 'Slash', 'Dagger_Stab', 'Jab', 'Punch'].includes(name);

// A small playback policy keeps the render loop independent of source filenames. The return value
// overrides the legacy animation only when this actor actually has the imported clips.
export function selectCharacterAnimation(v, p, ctx = {}) {
  if (!v.body?.userData.importedAnimations) return null;
  const state = v.motion042 ??= { shot: p.shot, side: 0, sideTime: 0, moving: false, stop: 0, attack: 0, serial: 0, landed: 0 };
  const dt = clamp(ctx.dt, 0, .1), speed = finite(p.moving), moving = speed > .5;
  state.attack = Math.max(0, state.attack - dt); state.stop = Math.max(0, state.stop - dt); state.landed = Math.max(0, state.landed - dt);
  const base = ctx.base || 'Idle', firearm = !!ctx.firearm && p.gear?.id !== 'aegis';
  const named = (name, options = {}) => ({ name: v.actions[name] ? name : base, speed: 1, once: false, serial: state.serial, ...options });
  if (p.shot !== state.shot) {
    state.shot = p.shot; state.serial++;
    if (ctx.stance === 'blade') { state.attackName = 'Slash'; state.attack = .7; }
    else if (ctx.stance === 'fists') { state.attackName = p.shot % 2 ? 'Jab' : 'DropKick'; state.attack = state.attackName === 'DropKick' ? .72 : .32; }
  }
  if (p.hp <= 0) return named('Death', { once: true });
  if (p.inBus || ctx.emote || p.healing > 0 || p.using) return named(base, { once: ['Use', 'Loot'].includes(base) });
  if (ctx.airborne || p.dropping || p.suitFlight) { state.side = 0; state.moving = false; return named(base === 'Jump_Start' ? 'Jump_Start' : 'Jump_Idle', { once: base === 'Jump_Start' }); }
  if (base === 'HitReact') return named(base, { once: true, speed: 1.5 });
  if (base === 'Jump_Land' && !state.wasLanding) state.landed = .8;
  state.wasLanding = base === 'Jump_Land';
  if (state.landed && !moving) return named('Jump_Land', { once: true, speed: v.actions.Jump_Land.getClip().duration / .8 });
  if (state.attack && state.attackName) return named(state.attackName, { once: true, speed: v.actions[state.attackName].getClip().duration / (state.attackName === 'DropKick' ? .72 : state.attackName === 'Slash' ? .7 : .32) });
  if (p.reload > 0 && firearm) {
    const name = moving ? speed < 4.2 ? 'Reload_Walk' : 'Reload_Run' : 'Reload';
    const w = WEAPONS[p.weapon], total = (w?.reload || 1) * (RARITIES[p.rarity]?.reload || 1);
    const duration = v.actions[name].getClip().duration;
    return named(name, { once: true, speed: duration / total, time: clamp(1 - p.reload / total, 0, 1) * duration });
  }
  const suffix = firearm ? ctx.shooting ? '_Shoot' : '_Gun' : '';
  if (moving) {
    state.stop = 0; state.moving = true;
    const rel = v.moveYaw === undefined ? 0 : wrap(v.moveYaw - (v.yaw || 0));
    if (Math.abs(rel) > 2.24) { state.side = 0; return named('Walk_Backward' + suffix, { fixedHeading: true, speed: clamp(speed / 2.1, .7, 1.9) }); }
    if (Math.abs(rel) > .9) {
      const side = rel > 0 ? 1 : -1;
      if (state.side !== side) { state.side = side; state.sideTime = 0; state.serial++; }
      else state.sideTime += dt;
      const entry = state.sideTime < .55, name = 'Strafe_' + (entry ? 'Start_' : '') + (side > 0 ? 'Left' : 'Right') + suffix;
      return named(name, { fixedHeading: true, once: entry, speed: entry ? v.actions[name].getClip().duration / .55 : clamp(speed / 2.4, .7, 1.8) });
    }
    state.side = 0;
    const walk = speed < 4.2;
    return named((walk ? 'Walk' : 'Run') + suffix, { speed: clamp(speed / (walk ? 2.4 : 5.8), walk ? .6 : .7, walk ? 1.8 : 1.7) });
  }
  state.side = 0;
  if (state.moving) { state.stop = .3; state.moving = false; state.serial++; }
  if (state.stop && !v.turnStep) return named('Run_Stop' + suffix, { once: true, speed: v.actions['Run_Stop' + suffix].getClip().duration / .3 });
  if (v.turnStep) return named(v.legYaw > 0 ? 'Turn_Right' : 'Turn_Left', { speed: 1.3 });
  if (['Loot', 'Throw', 'Drink', 'Use', 'Heal', 'Duck', 'Sit', 'Wave', 'Yes', 'No'].includes(base)) return named(base);
  return named(firearm && !p.lowReady ? ctx.shooting ? 'Idle_Shoot' : 'Idle_Gun' : 'Idle');
}

export function applyCharacterAnimationPlayback(v, motion) {
  if (!motion) return;
  const action = v.actions[motion.name]; if (!action) return;
  if (v.motionLast042?.name === motion.name && v.motionLast042.serial !== motion.serial && (motion.once || /Shoot$/.test(motion.name))) action.reset().play();
  action.setLoop(motion.once ? T.LoopOnce : T.LoopRepeat, motion.once ? 1 : Infinity);
  action.clampWhenFinished = motion.once; action.timeScale = motion.speed;
  if (motion.time !== undefined) { action.paused = false; action.time = motion.time; }
  if (motion.fixedHeading) { v.legYaw = 0; v.body.rotation.y = v.yaw; }
  v.motionLast042 = { name: motion.name, serial: motion.serial };
}
