import { createPortalUI, mountPortalExportLinks } from './crazygames-ui.js';
import { portal, portalMode, portalAdBusy, portalLoading } from './sdk.js';
let portalUi035 = null;
let portalSound035 = null;
import { developerMode, mountDeveloperSettings } from './developer-mode.js';
import { nearLift } from './lift-system.js';
import { buildLiftPanel } from './lift-ui.js';
let liftFloor033;
import { sweepVehicleContacts } from './vehicle-contact.js';
import { nearestVehicle } from './vehicle-system.js';
import { loadVehicleModels } from './vehicle-models.js';
import { vehicleTouch, updateVehicleHUD } from './vehicle-hud.js';
import { engineSound, vehicleReport } from './vehicle-audio.js';
import { nearestDoor } from './door-system.js';
import { loadAssets, setTextureQuality, TEXTURE_SIZES } from './assets.js';
import { lineClear } from './world.js';
import { LookInput } from './look-input.js';
import { relativeMove } from './combat.js';
import './style.css';
import { Arena, initPhysics } from './simulation.js';
import { View } from './render.js';
import { glSupport, glAdvice } from './gl-help.js';
import { WEAPONS, DEFAULT_SEED } from './world.js';
import { initSDK, gameplay, portalStorage, portalInvite, portalRoom, portalJoin } from './sdk.js';
import { BRANCHES, NODES, ABILITY_AT, ranksIn, rankCost, buyRank, packSkills, levelOf, maxLevel, perks as skillPerks } from './skills.js';
import { COSMETICS, KINDS, itemsOfKind, pack as packCosmetics, freshProfile, readProfile, buyOrEquip, rewardMatch, PASS_TIERS, PASS_TIER_XP, passTier, COSMETIC_RARITIES, cosmeticRarity } from './cosmetics.js';
import { roomCode, newRoomCode, inviteURL, validEndpoint } from './party.js';
import { RARITIES, GEAR, ARMOR_TIERS } from './catalog.js';
import { encodeLoadout, weaponStats, carryWeight } from './items.js';
import { Mirror, Interpolator, Predictor } from './netcode.js';
import { lobbySpot } from './lobby-stage.js';
import { Minimap } from './minimap.js';
import { DamageNumbers, feedLine } from './hud-fx.js';
import { Tutorial } from './tutorial.js';
import { hostGroup, joinGroup } from './p2p.js';
import { BOSSES, RELICS, MOVE_LABELS } from './bosses.js';
import { GRADE_FIELDS, GRADE_PRESETS, DEFAULT_GRADE, sanitizeGrade, startingGrade } from './grading.js';
// Map colours for parks and wild biomes (inventory map and minimap).
const ZONE_COLORS = {
  quarry: '#b6a180',
  grove: '#456b53',
  hill: '#6f8a58',
  park: '#638661',
  forest: '#3f6446',
  lake: '#4f8fa0',
  desert: '#d2b77e',
  glade: '#7fa860',
  meadow: '#93b260',
};
const $ = (s) => document.querySelector(s),
  show = (s, b) => $(s).classList.toggle('hidden', !b);
let view,
  sim,
  state,
  id = 'you',
  mode = 'menu',
  paused = false,
  slot = 1,
  lastSlot = 2,
  socket = null,
  netTimer = 0,
  last = 0,
  acc = 0,
  hit = 0,
  startedAt = 0,
  connectionTimer;
let profile = freshProfile(),
  saveStore = null,
  saveAvailable = true,
  panel = null,
  panelFocus = null,
  group = null,
  groupKey = '',
  connectedEndpoint = '',
  lastPacket = 0,
  latency = 0;
// Online (netcode.js, 0.28): chests and destruction arrive as deltas, others are shown slightly in the past between
// two states, and your own walking is predicted from your inputs.
const mirror = new Mirror(),
  interp = new Interpolator(90),
  predictor = new Predictor();
let lastSt = 0;
let cheatUnlocked = false,
  cheatBuffer = '',
  flyUp = false,
  flyDown = false,
  rewardedRound = null;
const cheatSettings = { flight: false, infinite: false, god: false, bazooka: false };
// Sandbox codes (solo only, rewards off): 250886 opens the cheat menu, 112358 hands over a rocket launcher.
const BAZOOKA_CODE = '112358';
let inventoryOpen = false,
  interact = false,
  detonate = false,
  heal = false,
  emote = false,
  dash = false,
  aiming = false;
// Third person by default; a saved choice wins.
let cameraView = 'third';
let mapSeed = DEFAULT_SEED,
  jump = false,
  sprintTouch = false,
  resultShown = false;
let config = { multiplayerUrl: '', room: 'park' };
let soloKind = 'royale';
const keys = new Set(),
  move = { x: 0, z: 0 },
  aim = { x: 0, z: 0, active: false };
let mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false },
  angle = 0,
  pitch = 0,
  reload = false,
  fireTouch = false,
  hadLock = false,
  lookPointer = null;
const lookInput = new LookInput();
let previousAlive = null;
const touch = matchMedia('(pointer:coarse)').matches || new URLSearchParams(location.search).has('touch');
document.body.classList.toggle('touch', touch);
let sound = true,
  audio = null;
function beep(weapon = 0, hitSound = false) {
  if (!sound || !audio) return;
  try {
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.type = hitSound ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(hitSound ? 820 : weapon === 1 ? 110 : 220, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(hitSound ? 1200 : 45, audio.currentTime + 0.08);
    g.gain.setValueAtTime(hitSound ? 0.045 : 0.028, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.11);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.12);
  } catch {}
}
// A few notes: item sips and chimes, the launch pad, the impulse whoosh, chests opening.
function tones(notes, { type = 'sine', vol = 0.035, gap = 0.07, dur = 0.16, slide = 1 } = {}) {
  if (!sound || !audio) return;
  try {
    notes.forEach((f, i) => {
      const o = audio.createOscillator(),
        g = audio.createGain(),
        t = audio.currentTime + i * gap;
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  } catch {}
}
// Ambience (0.27): the bus engine's drone while aboard, the wind in free fall and under the glider.
const amb = {};
function ambience(p) {
  if (!audio) return;
  try {
    if (!amb.hum) {
      const hum = audio.createGain(),
        low = audio.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 220;
      hum.gain.value = 0;
      for (const f of [54, 56.5, 109]) {
        const o = audio.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(low);
        o.start();
      }
      low.connect(hum).connect(audio.destination);
      // Wind: a second of looping noise through a band-pass filter.
      const buf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate),
        data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = audio.createBufferSource(),
        band = audio.createBiquadFilter(),
        wind = audio.createGain();
      noise.buffer = buf;
      noise.loop = true;
      band.type = 'bandpass';
      band.frequency.value = 520;
      band.Q.value = 0.6;
      wind.gain.value = 0;
      noise.connect(band).connect(wind).connect(audio.destination);
      noise.start();
      Object.assign(amb, { hum, wind, band });
    }
    const alive = !!p && p.hp > 0 && sound && mode !== 'menu' && !paused,
      hum = alive && p.inBus ? 0.05 : 0,
      wind = alive && p.dropping && !p.gliding ? 0.11 : alive && p.gliding ? 0.045 : alive && p.launched ? 0.06 : 0;
    amb.hum.gain.setTargetAtTime(hum, audio.currentTime, 0.25);
    amb.wind.gain.setTargetAtTime(wind, audio.currentTime, 0.25);
    amb.band.frequency.setTargetAtTime(p?.gliding ? 380 : 620, audio.currentTime, 0.4);
  } catch {}
}
// Two soft rising notes when a friend invites you.
function playInviteSound() {
  if (!sound || !audio) return;
  try {
    [660, 880].forEach((f, i) => {
      const o = audio.createOscillator(),
        g = audio.createGain(),
        t = audio.currentTime + i * 0.13;
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.22);
    });
  } catch {}
}
function unlockAudio() {
  if (portalAdBusy()) return;
  if (!audio)
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  audio?.resume().catch(() => {});
}
function clearInput() {
  flyUp = false;
  flyDown = false;
  interact = false; liftFloor033 = undefined;
  detonate = false;
  heal = false;
  emote = false;
  dash = false;
  aiming = false;
  lookInput.reset();
  keys.clear();
  jump = false;
  sprintTouch = false;
  mouse.down = false;
  fireTouch = false;
  lookPointer = null;
  move.x = move.z = aim.x = aim.z = 0;
  aim.active = false;
  reload = false;
  document.querySelectorAll('.stick i').forEach((e) => (e.style.transform = ''));
}
const rarityName = (r) => RARITIES[r]?.name || 'COMMON';
const rarityColor = (r) => RARITIES[r]?.color || RARITIES[0].color;
function me() {
  return state?.players.find((p) => p.id === id);
}
// First or third person: the camera swings behind your shoulder and your own character is drawn.
function applyCameraView(save = true) {
  view?.setThirdPerson(cameraView === 'third');
  if ($('#cameraView')) $('#cameraView').value = cameraView;
  if (save)
    try {
      localStorage.setItem('prida-camera', cameraView);
    } catch {}
}
function toggleCameraView() {
  cameraView = cameraView === 'third' ? 'first' : 'third';
  applyCameraView();
  toast(cameraView === 'third' ? 'THIRD PERSON · T' : 'FIRST PERSON · T');
}
// The debug sandbox runs only in a local match (never online, never on the server).
function debugging() {
  return developerMode() && mode === 'training' && sim?.mode === 'debug';
}
// Is the local player holding a remote charge (C4)?
function holdingCharge() {
  const p = me();
  return !!p && p.hp > 0 && !!WEAPONS[p.weapon]?.sticky;
}
function selectSlot(n) {
  const p = me();
  if (mode === 'menu' || !p?.slots?.[n]) return;
  if (n !== slot) lastSlot = slot;
  slot = n;
}
function cycleSlot(step) {
  const p = me();
  if (!p?.slots) return;
  for (let k = 1; k <= 5; k++) {
    const n = (slot + step * k + 10) % 5;
    if (p.slots[n]) return selectSlot(n);
  }
}
// ---- The items guide (lobby, 0.27) ---------------------------------------------------------------
// Nobody chooses a loadout any more: everyone drops in with bare hands. The ITEMS tab lists what can be found.
const GUIDE_ROWS = [
  ['primary', 'PRIMARY WEAPONS', 'Rifles, shotguns, SMGs and the heavy machine gun.', (w) => w.category === 'primary'],
  ['secondary', 'SIDEARMS', 'Pistols, revolvers and throwing blades.', (w) => w.category === 'secondary' && !w.fuse],
  ['power', 'POWER WEAPONS', 'Rare finds: long range, explosives, the minigun.', (w) => w.category === 'power' && !w.fuse && !w.sticky],
  ['melee', 'MELEE', 'Silent, no ammunition. Bare hands until you find a blade.', (w) => w.melee],
  ['throw', 'THROWABLES', 'Grenades and charges: throw with the fire button.', (w) => (w.fuse || w.sticky) && !w.consumable],
  ['items', 'SHIELDS AND HEALS', 'Hold them in your hands and press fire to use. Switching away cancels.', (w) => w.consumable && !w.deploy],
  ['deploy', 'DEPLOYABLES', 'Set down in front of you.', (w) => w.deploy],
];
function statLine(w) {
  if (w.fists) return 'What everyone starts with';
  if (w.desc) return w.desc;
  if (w.melee) return `${w.damage} dmg · ${w.range.toFixed(1)} m reach`;
  if (w.mag === 1) return `${w.damage} dmg · single shot · ${w.reserve} spare`;
  return `${w.damage}${w.pellets > 1 ? '×' + w.pellets : ''} dmg · ${w.mag} mag · ${Math.round(60 / w.interval)} rpm`;
}
function guideCard(i) {
  const w = WEAPONS[i],
    r = w.rarity !== undefined ? `<em style="color:${rarityColor(w.rarity)}">${rarityName(w.rarity)}</em> · ` : '';
  return `<button class="kit-choice" data-kit="weapon" data-value="${i}" style="--rarity:${w.rarity !== undefined ? rarityColor(w.rarity) : 'transparent'}"><span class="kit-art"><img src="./icons/${w.model}.png" alt=""></span><b>${w.name}</b><small>${r}${w.ru} · ${statLine(w)}</small></button>`;
}
function gearCard(g) {
  return `<button class="kit-choice" data-kit="gear" data-value="${g.id}"><span class="kit-art"><img src="./icons/${g.model}.png" alt=""></span><b>${g.name}</b><small>${g.desc}</small></button>`;
}
// The play tab shows a few highlights; any of them opens the full list.
function renderLoadoutSummary() {
  const picks = ['fists', 'rifle', 'shieldcell', 'shieldkeg', 'launchpad', 'sticky', 'coverwall', 'overcharge'].map((m) => WEAPONS.findIndex((w) => w.model === m));
  $('#loadoutSummary').innerHTML = picks
    .map((i) => `<button class="kit-slot" data-open-loadout="${i}" style="--rarity:${rarityColor(WEAPONS[i].rarity ?? 0)}"><small>${WEAPONS[i].fists ? 'START' : WEAPONS[i].consumable ? 'ITEM' : 'WEAPON'}</small><img src="./icons/${WEAPONS[i].model}.png" alt=""><b>${WEAPONS[i].name}</b></button>`)
    .join('');
  document.querySelectorAll('[data-open-loadout]').forEach((e) => (e.onclick = () => setTab('loadout')));
}
function renderLoadoutPanel() {
  $('#loadoutRows').innerHTML =
    GUIDE_ROWS.map(([key, label, note, pick]) => {
      const list = WEAPONS.flatMap((w, i) => (pick(w) ? [i] : []));
      return `<section class="kit-row" data-row="${key}"><header><b>${label}</b><small>${note}</small></header><div class="kit-grid">${list.map(guideCard).join('')}</div></section>`;
    }).join('') +
    `<section class="kit-row"><header><b>GEAR</b><small>Worn on the back or the arm. Found in chests.</small></header><div class="kit-grid">${GEAR.map(gearCard).join('')}</div></section>` +
    `<section class="kit-row"><header><b>RELICS</b><small>Dropped by the four bosses of the wilds. They take their own place in your belt: F and G use them, and they drop if you fall.</small></header><div class="kit-grid">${Object.values(RELICS)
      .map((r) => `<div class="kit-choice relic-card" style="--rarity:#${r.color.toString(16).padStart(6, '0')}"><span class="kit-art"><i class="gem"></i></span><b>${r.name}</b><small>${BOSSES[r.boss].name} · ${r.abilities.map((a) => a.label).join(' · ')}</small></div>`)
      .join('')}</div></section>`;
  // Pointing at a weapon, an item or gear puts it on the character on the stage.
  document.querySelectorAll('[data-kit]').forEach((e) => {
    const key = e.dataset.kit,
      value = key === 'gear' ? e.dataset.value : +e.dataset.value;
    e.onpointerenter = e.onfocus = e.onclick = () => {
      if (key === 'gear') lobby.gear = value;
      else lobby.weapon = value;
    };
    e.onpointerleave = e.onblur = () => {
      lobby.weapon = lobby.gear = null;
    };
  });
}
// The five slots; the relic a boss dropped has its own place after them (0.27, in the page): F / G use it.
$('#weaponBar').insertAdjacentHTML('afterbegin', [0, 1, 2, 3, 4].map((i) => `<button data-slot="${i}"><span>${i + 1}</span><img alt=""><b></b></button>`).join(''));
if (touch) $('#relicSlot span').textContent = 'RELIC';
document.querySelectorAll('[data-slot]').forEach((e) => (e.onclick = () => selectSlot(+e.dataset.slot)));
function begin(m) {
  closePanel();
  rewardedRound = null;
  $('#rewardText').textContent = '';
  lastHP = 100;
  inventoryOpen = false;
  show('#inventory', false);
  const player = state.players.find((p) => p.id === id);
  angle = player?.angle ?? 0;
  pitch = 0;
  previousAlive = null;
  resultShown = false;
  mode = m;
  paused = false;
  startedAt = performance.now();
  clearInput();
  unlockAudio();
  document.body.classList.add('playing');
  show('#menu', false);
  show('#sceneLabel', false);
  show('#hud', true);
  show('#pauseBtn', true);
  show('#pause', false);
  $('#modeLabel').textContent =
    state.mode === 'royale'
      ? (state.size === 'city' ? 'BIG CITY · ' : 'MINI ROYALE · ') + (m === 'online' ? 'ONLINE' : 'SOLO')
      : state.mode === 'duel'
        ? state.size === 'city'
          ? 'DUEL · BIG CITY'
          : 'DUEL · 1 V 1'
      : m === 'online'
        ? 'ARENA · ' + (group?.code || '')
        : state.mode === 'survival'
          ? 'SURVIVAL · ONE LIFE'
          : state.mode === 'tutorial'
            ? 'TUTORIAL'
            : state.mode === 'debug'
              ? 'SANDBOX'
              : 'TRAINING · BOTS';
  slot = player?.slot ?? 1;
  lastSlot = 0;
  inventoryKey = '';
  show('#netStatus', m === 'online');
  $('#connectionStatus').textContent = '';
  $('#feed').replaceChildren();
  damageNumbers.clear();
  gameplay(true);
  captureMouse();
}
function train(kind = $('#gameMode').value) {
  if (String(kind).includes('debug') && !developerMode()) { toast('Enable Developer Mode in Settings first.'); return; }
  disconnect();
  clearTimeout(connectionTimer);
  tutorial?.dispose();
  tutorial = null;
  sim?.dispose();
  soloKind = kind;
  const city = kind === 'royale-city',
    mode = city ? 'royale' : kind;
  sim = new Arena({
    bots: city ? 23 : mode === 'royale' ? 9 : mode === 'debug' || mode === 'tutorial' ? 0 : 16,
    seed: mapSeed,
    mode,
    size: city || mode === 'debug' ? 'city' : 'district',
    allowCheats: developerMode(),
    bus: mode === 'royale',
  });
  const p = sim.addPlayer('you', 'YOU');
  p.cosmetics = { ...profile.equipped };
  sim.setLoadout(p, profile.loadout);
  sim.setSkills(p, profile.skills);
  id = 'you';
  applyCheats();
  if (mode === 'tutorial') {
    tutorial = new Tutorial(sim, 'you', touch);
    try {
      localStorage.setItem('prida-tutorial', 'seen');
    } catch {}
  }
  state = sim.snapshot();
  begin('training');
  renderTutorial();
}
$('#train').onclick = () => train();
// ---- Tutorial (0.27) ------------------------------------------------------------------------------
let tutorial = null,
  tutorialKey = '';
function renderTutorial(advanced = false) {
  const t = mode === 'training' && tutorial ? tutorial.view() : null;
  show('#tutorialPanel', !!t);
  document.body.classList.toggle('tutorial', !!t);
  if (!t) return;
  const key = t.id + t.index;
  if (key !== tutorialKey) {
    tutorialKey = key;
    $('#tutStep').textContent = t.finished ? 'TUTORIAL COMPLETE' : `STEP ${t.index + 1} / ${t.count - 1}`;
    $('#tutTitle').textContent = t.title;
    $('#tutText').textContent = t.text;
    $('#tutFill').style.width = (t.index / (t.count - 1)) * 100 + '%';
    show('#tutDone', t.finished);
    show('#tutSkip', !t.finished);
    const el = $('#tutorialPanel');
    el.classList.remove('advance');
    void el.offsetWidth;
    if (advanced) el.classList.add('advance');
    if (t.finished) {
      try {
        localStorage.setItem('prida-tutorial', 'done');
      } catch {}
      releaseMouse();
      gameplay(false);
    }
  }
}
function tutorialStep(events, dt) {
  if (!tutorial) return;
  if (tutorial.update(dt, events)) {
    tones([660, 880, 1175], { vol: 0.035, gap: 0.06, dur: 0.2 });
    renderTutorial(true);
  }
}
$('#tutSkip').onclick = () => {
  tutorial?.skip();
  renderTutorial(true);
  captureMouse();
};
$('#tutRoyale').onclick = () => {
  $('#gameMode').value = 'royale';
  $('#gameMode').dispatchEvent(new Event('change'));
  train('royale');
};
$('#tutLobby').onclick = () => leave();
// First visit: offer the tutorial in the lobby, once.
function offerTutorial() {
  let seen = null;
  try {
    seen = localStorage.getItem('prida-tutorial');
  } catch {}
  $('#tutorialOffer').hidden = !!seen;
}
$('#tutStart').onclick = () => {
  $('#tutorialOffer').hidden = true;
  unlockAudio();
  train('tutorial');
};
$('#tutNo').onclick = () => {
  $('#tutorialOffer').hidden = true;
  try {
    localStorage.setItem('prida-tutorial', 'declined');
  } catch {}
};
$('#infoTutorial').onclick = () => train('tutorial');
$('#gameMode').onchange = () => {
  const k = $('#gameMode').value;
  $('#modeDescription').textContent =
    k === 'royale'
      ? 'You + 9 bots. A shrinking zone. Last survivor wins.'
      : k === 'royale-city'
        ? 'The big city, 8× the district: you + 23 bots, a slower zone. Last survivor wins.'
      : k === 'survival'
        ? 'You against 16 bots. One life each.'
        : k === 'debug'
          ? 'Sandbox for testing: no storm, no timer, every weapon and item on tap (J). No rewards.'
          : k === 'tutorial'
            ? 'A two-minute walk-through: moving, bare hands, chests, shooting, shields, the launch pad.'
            : 'First to 10 eliminations. Respawns enabled.';
  $('#train span').textContent =
    k === 'royale'
      ? 'MINI ROYALE · 10 CONTENDERS'
      : k === 'royale-city'
        ? 'BIG CITY · 24 CONTENDERS'
        : k === 'survival'
          ? 'SURVIVAL · 16 BOTS'
          : k === 'debug'
            ? 'DEBUG · SANDBOX'
            : k === 'tutorial'
              ? 'TUTORIAL · THE BASICS'
              : 'TRAINING · RESPAWNS ON';
};
$('#newMap').onclick = () => {
  if (socket) return;
  mapSeed = Math.floor(Math.random() * 999999) + 1;
  $('#seedLabel').textContent = 'DISTRICT #' + mapSeed;
  sim?.dispose();
  sim = new Arena({ bots: 9, seed: mapSeed });
  const p = sim.addPlayer('you', 'YOU');
  p.cosmetics = { ...profile.equipped };
  state = sim.snapshot();
};
$('#replay').onclick = () => {
  if (mode === 'online') socket?.send(JSON.stringify({ type: 'start' }));
  else train(soloKind);
};
$('#resultMenu').onclick = () => leave();
$('#returnGroup').onclick = () => socket?.send(JSON.stringify({ type: 'lobby' }));
$('#online').onclick = () => openPanel('party');
function disconnect() {
  clearTimeout(connectionTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  group = null;
  groupKey = '';
  portalRoom(null);
  show('#groupPanel', false);
  setConnecting(false);
}
function setConnecting(on) {
  $('#createGroup').disabled = $('#joinGroup').disabled = $('#quickRoyale').disabled = $('#quickDuel').disabled = $('#quickDuelCity').disabled = on;
  for (const el of ['nickname', 'room', 'partyMode', 'endpoint']) $('#' + el).disabled = on;
}
// Server address: typed by the player, set in config.json, or — when the page is served by the PRIDA server
// itself ("auto") or from a local network — the page's own host.
function serverEndpoint() {
  const local =
    ['localhost', '127.0.0.1'].includes(location.hostname) ||
    /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(location.hostname);
  const own = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  const typed = $('#endpoint').value.trim();
  if (typed && typed !== 'auto') return typed;
  if (config.multiplayerUrl === 'auto') return own;
  return config.multiplayerUrl || (local ? own : '');
}
// Only your own inventory comes from the server (`self.slots`); everyone else's stays there.
function ownSlots(st, self) {
  for (const p of st.players || []) p.slots = p.id === id ? self?.slots || [] : p.slots || [];
  return st;
}
function connectGroup(create = false, queue = null) {
  if (socket) return;
  unlockAudio();
  const endpoint = serverEndpoint();
  if (!endpoint) {
    $('#network').open = true;
    $('#connectionStatus').textContent =
      'No online server is configured for this build. Enter a running PRIDA server address, or play Solo.';
    return;
  }
  if (create) $('#room').value = newRoomCode();
  const code = queue ? '' : roomCode($('#room').value);
  if (!code && !queue) {
    $('#connectionStatus').textContent = 'Enter your friend’s group code.';
    return;
  }
  if (!queue) $('#room').value = code;
  try {
    const url = validEndpoint(endpoint, location.protocol === 'https:');
    connectedEndpoint = url.href;
    if (queue) url.searchParams.set('queue', queue);
    else {
      url.searchParams.set('room', code);
      url.searchParams.set('party', '1');
      url.searchParams.set('mode', $('#partyMode').value);
    }
    url.searchParams.set('name', $('#nickname').value.slice(0, 16) || 'PLAYER');
    url.searchParams.set('cos', packCosmetics(profile.equipped));
    url.searchParams.set('loadout', encodeLoadout(profile.loadout));
    url.searchParams.set('skills', packSkills(profile.skills));
    // Private groups play directly between browsers by default (the host's computer runs the match); the server
    // only introduces them. Quick match always goes through the server.
    const direct = !queue && $('#directMode').checked && typeof RTCPeerConnection === 'function';
    groupDirect = direct;
    const params = {
        name: $('#nickname').value.slice(0, 16) || 'PLAYER',
        cos: packCosmetics(profile.equipped),
        loadout: encodeLoadout(profile.loadout),
        skills: packSkills(profile.skills),
      };
    socket = direct
      ? create
        ? hostGroup({ endpoint: url.href, code, kind: $('#partyMode').value, params })
        : joinGroup({ endpoint: url.href, code, params })
      : new WebSocket(url);
    const active = socket;
    setConnecting(true);
    $('#connectionStatus').textContent = direct ? (create ? 'Opening your group…' : 'Connecting directly to the host…') : 'Connecting…';
    connectionTimer = setTimeout(() => active.close(), direct ? 20000 : 7000);
    active.onmessage = (e) => {
      if (socket !== active) return;
      lastPacket = performance.now();
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'pong') {
        latency = Math.round(performance.now() - msg.sent);
        return;
      }
      if (msg.type === 'error') {
        $('#connectionStatus').textContent = msg.message;
        return;
      }
      if (msg.type === 'welcome') {
        clearTimeout(connectionTimer);
        id = msg.id;
        sim?.dispose();
        sim = null;
        mirror.reset();
        interp.reset();
        predictor.reset();
        lastSt = 0;
        state = ownSlots(mirror.apply(msg.state), msg.self);
        group = msg.group;
        $('#connectionStatus').textContent = msg.group?.public
          ? 'Connected. Waiting for players…'
          : 'Connected. Invite friends or start with bots.';
        renderGroup();
      }
      if (msg.type === 'state') {
        const previous = group?.phase,
          previousMatch = group?.match;
        // Chests and destruction come as changes against what we already have (the mirror keeps the full copy).
        ownSlots(mirror.apply(msg.state), msg.self);
        // Over the lossy direct link a state can arrive after a newer one: its events still count, its picture not.
        if (Number.isFinite(msg.state.st) && msg.state.st < lastSt) {
          for (const event of msg.events || []) handleEvent(event);
          return;
        }
        lastSt = msg.state.st || 0;
        interp.push(msg.state);
        const mine = msg.state.players.find((p) => p.id === id);
        if (mine?.vehicle) predictor.idle(mine);
        else if (mine && view?.map) predictor.server(mine, msg.self?.ack, view.map, predictCtx(mine));
        state = msg.state;
        // The group only comes when it changes.
        if ('group' in msg) group = msg.group;
        renderGroup();
        if (
          group?.phase === 'playing' &&
          (mode !== 'online' || previous !== 'playing' || group?.match !== previousMatch)
        )
          begin('online');
        if (group?.phase === 'lobby' && mode === 'online') {
          lobbyShell();
          openPanel('party');
        }
        for (const event of msg.events || []) handleEvent(event);
      }
    };
    active.onclose = (e) => {
      if (socket !== active) return;
      socket = null;
      group = null;
      groupKey = '';
      setConnecting(false);
      clearTimeout(connectionTimer);
      portalRoom(null);
      leave();
      openPanel('party');
      $('#connectionStatus').textContent = e.reason || 'Connection lost. Check the server and try again.';
      $('#network').open = true;
    };
    active.onerror = () => {};
  } catch (e) {
    $('#connectionStatus').textContent = e.message;
    disconnect();
  }
}
$('#createGroup').onclick = () => connectGroup(true);
$('#quickRoyale').onclick = () => connectGroup(false, 'royale-city');
$('#quickDuel').onclick = () => connectGroup(false, 'duel');
$('#quickDuelCity').onclick = () => connectGroup(false, 'duel-city');
$('#joinGroup').onclick = () => connectGroup(false);
$('#disconnectGroup').onclick = () => {
  disconnect();
  leave();
  openPanel('party');
};
$('#startGroup').onclick = () => socket?.send(JSON.stringify({ type: 'start' }));
function renderGroup() {
  if (!group) return;
  const key = JSON.stringify(group);
  if (key === groupKey) return;
  groupKey = key;
  show('#groupPanel', true);
  $('#groupCode').textContent = group.public ? group.label.toUpperCase() + ' · QUICK MATCH' : 'GROUP ' + group.code + ' · ' + group.label.toUpperCase();
  $('#groupMembers').replaceChildren();
  for (const m of group.members) {
    const li = document.createElement('li');
    li.textContent = m.name + (m.id === group.host ? ' · HOST' : '') + (m.id === id ? ' · YOU' : '');
    $('#groupMembers').append(li);
  }
  $('#groupFill').textContent =
    group.mode === 'duel' || group.mode === 'duel-city'
      ? `${group.members.length} / 2 players · first to 5 eliminations${group.mode === 'duel-city' ? ' · inside the ring' : ''}`
      : `${group.members.length} players + ${group.bots} bots = ${group.contenders} contenders`;
  if (group.public) {
    $('#groupFill').textContent +=
      group.countdown !== null && group.phase === 'lobby' ? ` · starting in ${group.countdown} s` : ' · waiting for players';
  }
  show('#startGroup', !group.public);
  show('#copyInvite', !group.public);
  $('#startGroup').disabled = group.host !== id;
  $('#startGroup').textContent = group.host === id ? 'START MATCH' : 'WAITING FOR HOST';
  if (!group.public) $('#partyMode').value = group.mode;
  renderGroupFriends();
  portalRoom(group, connectedEndpoint);
}
$('#copyInvite').onclick = async () => {
  if (!group) return;
  const link =
    (await portalInvite({ party: group.code, server: connectedEndpoint })) ||
    inviteURL(location.href, group.code, connectedEndpoint);
  $('#inviteOutput').value = link;
  show('#inviteOutput', true);
  try {
    await navigator.clipboard.writeText(link);
    $('#connectionStatus').textContent = 'Invite copied. Send it to your friends.';
  } catch {
    $('#inviteOutput').select();
    $('#connectionStatus').textContent = 'Copy the link below and send it to your friends.';
  }
};
function lobbyShell() {
  inventoryOpen = false;
  show('#inventory', false);
  closePanel();
  gameplay(false);
  mode = 'menu';
  paused = false;
  releaseMouse();
  clearInput();
  document.body.classList.remove('playing', 'dead');
  show('#menu', true);
  show('#sceneLabel', true);
  for (const el of ['hud', 'pause', 'pauseBtn', 'announcement']) show('#' + el, false);
}
function leave() {
  disconnect();
  tutorial?.dispose();
  tutorial = null;
  lobbyShell();
  show('#tutorialPanel', false);
  offerTutorial();
  sim?.dispose();
  sim = new Arena({ bots: 9, seed: mapSeed });
  const p = sim.addPlayer('you', 'YOU');
  p.cosmetics = { ...profile.equipped };
  state = sim.snapshot();
  id = 'you';
  updateWallet();
}
function pause(b) {
  if (mode === 'menu') return;
  if (b) closePanel();
  if (inventoryOpen) {
    inventoryOpen = false;
    show('#inventory', false);
  }
  paused = b;
  if (b) releaseMouse();
  else captureMouse();
  clearInput();
  show('#pause', b);
  $('#pauseNote').textContent =
    mode === 'online' ? 'Online play continues while this menu is open.' : 'Solo match paused.';
  gameplay(!b && state.winner === null);
}
$('#pauseBtn').onclick = () => pause(!paused);
$('#resume').onclick = () => {
  unlockAudio();
  pause(false);
};
$('#leave').onclick = leave;
$('#quality').onchange = () => {
  view?.setQuality($('#quality').value);
  try {
    localStorage.setItem('blockyard-quality', $('#quality').value);
  } catch {}
};
$('#sound').onclick = () => {
  sound = !sound;
  $('#sound').textContent = 'SOUND ' + (sound ? 'ON' : 'OFF');
  if (sound) unlockAudio();
};
$('#fullscreen').onclick = () => {
  try {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    p?.catch(() => {});
  } catch {}
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && panel) {
    e.preventDefault();
    closePanel();
    return;
  }
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (developerMode() && mode !== 'online' && !e.repeat && /^Digit[0-9]$/.test(e.code)) {
    cheatBuffer = (cheatBuffer + e.code.slice(-1)).slice(-6);
    if (cheatBuffer === '250886') {
      cheatUnlocked = true;
      openPanel('cheatPanel');
      updateCheatPanel();
      cheatBuffer = '';
      return;
    }
    if (cheatBuffer === BAZOOKA_CODE) {
      cheatBuffer = '';
      grantBazooka();
      return;
    }
  }
  if (panel) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (!e.repeat) {
      if (inventoryOpen) toggleInventory(false);
      else pause(true);
    }
    return;
  }
  if (portalAdBusy()) { e.preventDefault(); return; }
  if (mode === 'menu' || paused) return;
  if (['KeyI', 'KeyM', 'Tab'].includes(e.code)) {
    e.preventDefault();
    if (!e.repeat) toggleInventory(!inventoryOpen);
    return;
  }
  if (inventoryOpen) return;
  keys.add(e.code);
  if (e.code === 'KeyR') reload = true;
  if (e.code === 'KeyE' && !e.repeat) requestUse033();
  if (e.code === 'KeyH' && !e.repeat) heal = true;
  if (e.code === 'KeyB' && !e.repeat) emote = true;
  if (e.code === 'KeyV' && !e.repeat) dash = true;
  if (e.code === 'KeyJ' && !e.repeat && debugging()) openPanel('debugPanel');
  if (e.code === 'KeyT' && !e.repeat) toggleCameraView();
  if (e.code === 'Space' && !e.repeat) jump = true;
  if (/^Digit[1-5]$/.test(e.code)) selectSlot(+e.code.slice(-1) - 1);
  if (e.code === 'KeyQ' && !e.repeat && !me()?.vehicle) selectSlot(lastSlot);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener(
  'wheel',
  (e) => {
    if (!canLook() || Math.abs(e.deltaY) < 1) return;
    cycleSlot(e.deltaY > 0 ? 1 : -1);
  },
  { passive: true },
);
function captureMouse() {
  if (touch || !canLook()) return;
  try {
    const p = $('#game').requestPointerLock?.();
    p?.catch(() => {});
  } catch {}
}
function releaseMouse() {
  if (document.pointerLockElement) document.exitPointerLock();
}
function canLook() {
  return (
    !portalAdBusy() && mode !== 'menu' &&
    !paused &&
    !inventoryOpen &&
    !panel &&
    state?.winner === null &&
    (state.players.find((p) => p.id === id)?.hp ?? 0) > 0
  );
}
function applyLook(delta) {
  if (delta && canLook()) look(delta.dx, delta.dy);
}
function look(dx, dy) {
  angle = Math.atan2(Math.sin(angle - dx * 0.0025), Math.cos(angle - dx * 0.0025));
  pitch = Math.max(-1.35, Math.min(1.35, pitch - dy * 0.0025));
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('#game');
  lookInput.lockChanged();
  mouse.down = false;
  if (hadLock && !locked && canLook()) pause(true);
  hadLock = locked;
});
// Touch look drags use pointer events; mouse buttons use mousedown/mouseup. Pointer events only report the first
// button of a chord (a second button pressed while one is held arrives as a pointermove), so aiming with the right
// button and then firing with the left never fired, and letting go of the aim while firing left it stuck on.
$('#game').addEventListener('pointerdown', (e) => {
  if (!canLook() || e.pointerType !== 'touch') return;
  if (lookPointer === null && e.clientX > innerWidth * 0.35) {
    lookPointer = e.pointerId;
    lookInput.startDrag(e.pointerId, e.clientX, e.clientY);
    $('#game').setPointerCapture(e.pointerId);
  }
});
$('#game').addEventListener('mousedown', (e) => {
  if (!canLook() || (touch && e.sourceCapabilities?.firesTouchEvents)) return;
  if (e.button === 2) {
    // A demolition charge has no sights: the aim button is its detonator.
    if (holdingCharge()) detonate = true;
    else aiming = true;
    return;
  }
  if (e.button !== 0) return;
  if (document.pointerLockElement !== $('#game')) {
    captureMouse();
    lookInput.startDrag('mouse', e.clientX, e.clientY);
  }
  mouse.down = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) aiming = false;
  if (e.button === 0) {
    mouse.down = false;
    lookInput.endDrag('mouse');
  }
});
// Mouse relative movement has one source; pointermove handles touch only.
window.addEventListener('mousemove', (e) => {
  if (!canLook()) return;
  if (document.pointerLockElement === $('#game')) applyLook(lookInput.relative(e.movementX, e.movementY));
  else if (mouse.down) applyLook(lookInput.drag('mouse', e.clientX, e.clientY));
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && canLook() && e.pointerId === lookPointer)
    applyLook(lookInput.drag(e.pointerId, e.clientX, e.clientY));
});
window.addEventListener('pointerup', (e) => {
  // The last mouse button let go: nothing can still be held (covers a mouseup lost outside the window).
  if (e.pointerType === 'mouse' && e.buttons === 0) {
    mouse.down = aiming = false;
    lookInput.endDrag('mouse');
  }
  if (e.pointerId === lookPointer) {
    lookPointer = null;
    lookInput.endDrag(e.pointerId);
  }
});
window.addEventListener('pointercancel', clearInput);
window.addEventListener('blur', () => {
  clearInput();
  if (mode !== 'menu') pause(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode !== 'menu') pause(true);
});
$('#game').addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerup', () => {
  if (audio && audio.state !== 'running') audio.resume().catch(() => {});
});
function stick(el, value, isAim) {
  let active = null,
    center = { x: 0, y: 0 };
  const dot = el.querySelector('i');
  const update = (e) => {
    const dx = e.clientX - center.x,
      dy = e.clientY - center.y,
      r = Math.max(1, Math.hypot(dx, dy) / 36);
    value.x = dx / r / 36;
    value.z = dy / r / 36;
    if (isAim) value.active = Math.hypot(dx, dy) > 8;
    dot.style.transform = `translate(${dx / r}px,${dy / r}px)`;
  };
  el.addEventListener('pointerdown', (e) => {
    if (active !== null) return;
    active = e.pointerId;
    el.setPointerCapture(active);
    let r = el.getBoundingClientRect();
    center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    update(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === active) update(e);
  });
  const stop = (e) => {
    if (e.pointerId !== active) return;
    active = null;
    value.x = value.z = 0;
    value.active = false;
    dot.style.transform = '';
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('lostpointercapture', stop);
}
stick($('#moveStick'), move, false);
$('#fireBtn').addEventListener('pointerdown', (e) => {
  if (!canLook()) return;
  fireTouch = true;
  $('#fireBtn').setPointerCapture(e.pointerId);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('#fireBtn').addEventListener(name, () => (fireTouch = false));
// Relic abilities: F / G on keyboard, two round buttons on touch screens (held while pressed).
const abilityTouch = [false, false];
['#ability1Btn', '#ability2Btn'].forEach((sel, k) => {
  $(sel).addEventListener('pointerdown', (e) => {
    abilityTouch[k] = true;
    $(sel).setPointerCapture(e.pointerId);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $(sel).addEventListener(name, () => (abilityTouch[k] = false));
});
$('#touchReload').onclick = () => (reload = true);
$('#interactBtn').onclick = requestUse033;
$('#emoteBtn').onclick = () => (emote = true);
$('#dashBtn').onclick = () => (dash = true);
$('#aimBtn').onclick = () => (holdingCharge() ? (detonate = true) : (aiming = !aiming));
$('#inventoryBtn').onclick = () => toggleInventory(true);
$('#closeInventory').onclick = () => toggleInventory(false);
$('#healBtn').onclick = () => {
  toggleInventory(false);
  heal = true;
};
$('#jumpBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (canLook()) {
    jump = true;
    flyUp = true;
    $('#jumpBtn').setPointerCapture(e.pointerId);
  }
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('#jumpBtn').addEventListener(type, () => (flyUp = false));
$('#flyDown').addEventListener('pointerdown', (e) => {
  if (canLook()) {
    flyDown = true;
    $('#flyDown').setPointerCapture(e.pointerId);
  }
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('#flyDown').addEventListener(type, () => (flyDown = false));
$('#sprintBtn').addEventListener('pointerdown', (e) => {
  if (!canLook()) return;
  sprintTouch = true;
  $('#sprintBtn').setPointerCapture(e.pointerId);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('#sprintBtn').addEventListener(name, () => (sprintTouch = false));
function requestUse033() {
  const near = view?.map && nearLift(view.map,me());
  if (!near?.inside) { interact = true; return; }
  buildLiftPanel(near.lift, floor => {
    closePanel(); pause(false); liftFloor033 = floor;
  }, () => { closePanel(); pause(false); });
  openPanel('liftPanel033');
}
function input() {
  const right =
    move.x + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const forward =
    -move.z + (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const world = relativeMove(right, forward, angle),
    // Third person: fire from the eye at what the crosshair is on, not parallel to the camera (render.js, aim.js).
    fix = me()?.vehicle ? null : view?.aimFix;
  return {
    liftFloor: canLook() ? liftFloor033 : undefined,
    x: canLook() ? world.x : 0,
    z: canLook() ? world.z : 0,
    angle: fix ? Math.atan2(Math.sin(angle + fix.angle), Math.cos(angle + fix.angle)) : angle,
    pitch: fix ? Math.max(-1.35, Math.min(1.35, pitch + fix.pitch)) : pitch,
    fire: canLook() && (touch ? fireTouch : mouse.down),
    turretAngle: view?.vehicleGunAim && view.vehicleGunAim.id === me()?.vehicle ? view.vehicleGunAim.angle : angle,
    turretPitch: view?.vehicleGunAim && view.vehicleGunAim.id === me()?.vehicle ? view.vehicleGunAim.pitch : pitch,
    drive: canLook() ? Math.max(-1, Math.min(1, forward)) : 0,
    steer: canLook() ? Math.max(-1, Math.min(1, right)) : 0,
    vehicleAlt: canLook() && (aiming || vehicleTouch.alt),
    vehicleRocket: canLook() && !!me()?.vehicle && (keys.has('KeyQ') || vehicleTouch.rocket),
    vehicleBrake: canLook() && (vehicleTouch.brake || (me()?.vehicle && keys.has('Space') && state.vehicles?.find(v => v.id === me().vehicle)?.kind !== 'plane')),
    reload: !paused && reload,
    jump: canLook() && jump,
    ascend: canLook()
      ? (flyUp || vehicleTouch.up || keys.has('Space') ? 1 : 0) -
        (flyDown || vehicleTouch.down || keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight') ? 1 : 0)
      : 0,
    interact: canLook() && interact,
    detonate: canLook() && detonate,
    heal: canLook() && heal,
    emote: canLook() && emote,
    dash: canLook() && dash,
    ability1: canLook() && (keys.has('KeyF') || abilityTouch[0]),
    ability2: canLook() && (keys.has('KeyG') || abilityTouch[1]),
    sprint: canLook() && (sprintTouch || keys.has('ShiftLeft') || keys.has('ShiftRight')),
    slot,
  };
}
function handleEvent(e) {
  if (e.type === 'lift-arrived' && me() && Math.hypot(e.x-me().x,e.z-me().z)<9 && Math.abs(e.y-me().y)<3)
    tones([660,880],{type:'sine',vol:.025,dur:.07,gap:.06});
  vehicleReport(audio, e, me(), sound);
  if (e.id === id && e.type === 'vehicle-blocked') toast(e.why);
  if (e.id === id && e.type === 'vehicle-serviced') toast('VEHICLE REPAIRED / REARMED');
  if (e.type === 'door-blocked' && e.id === id) toast('DOOR BLOCKED', '#ffd39c');
  if (e.type === 'door' && me() && Math.hypot(e.x-me().x, e.z-me().z)<12)
    tones(e.open ? [170,240] : [230,140], {type:'triangle',vol:0.025,dur:0.075,gap:0.05});
  view.event(e);
  if (e.type === 'boss-down') {
    const b = BOSSES[e.kind],
      who = state.players.find((p) => p.id === e.by)?.name;
    toast(`${b.name} · ${b.title} DEFEATED${who ? ' BY ' + who : ''} · ${RELICS[b.relic].name} DROPPED`, '#' + b.color.toString(16).padStart(6, '0'));
  }
  if (e.type === 'relic' && e.id === id) {
    const r = RELICS[e.relic],
      keysLabel = r.abilities.map((a, k) => (touch ? '' : ['F', 'G'][k] + ' · ') + a.label).join('   ');
    toast(`${r.name} · ${r.passive ? r.passive + '   ' : ''}${keysLabel}`, '#' + r.color.toString(16).padStart(6, '0'));
  }
  if (e.type === 'crit' && e.id === id) toast(e.cyber ? 'CYBER STRIKE · ONE-SHOT' : 'ONE-SHOT · TITAN GLOVES', '#e0a33c');
  if (e.type === 'momentum' && e.id === id) toast('MOMENTUM · INSTANT RELOAD', '#7fd6f0');
  // Items (0.27).
  if (e.type === 'use-start' && e.id === id) tones([420, 470], { vol: 0.02, dur: 0.1 });
  if (e.type === 'use' && e.id === id) {
    const w = WEAPONS[e.item];
    if (!w.deploy) toast(`${w.name} · ${ITEM_DONE(w)}`, w.color);
    tones(w.deploy ? [180, 140] : [660, 990], { type: w.deploy ? 'square' : 'sine', vol: w.deploy ? 0.025 : 0.035, dur: w.deploy ? 0.12 : 0.2 });
  }
  if (e.type === 'use-blocked' && e.id === id) {
    toast(e.why, '#ffb070');
    tones([220], { type: 'square', vol: 0.02, dur: 0.1 });
  }
  if (e.type === 'deploy' && e.id === id) toast({ pad: 'LAUNCH PAD SET · STEP ON IT', wall: 'COVER WALL UP', fire: 'CAMPFIRE LIT · STAND CLOSE TO HEAL' }[e.kind] || 'SET DOWN', '#c9b6ff');
  if (e.type === 'pad' && e.id === id) tones([260, 520], { slide: 2.2, dur: 0.3, vol: 0.04, gap: 0.05 });
  if (e.type === 'impulse') {
    const p = me(),
      d = p ? Math.hypot(p.x - e.x, p.z - e.z) : 99;
    if (d < 30) tones([520], { type: 'sawtooth', slide: 0.25, dur: 0.4, vol: 0.035 * (1 - d / 30) });
  }
  if (e.type === 'stick' && e.on === id) toast('A CLINGER IS STUCK TO YOU · RUN', '#ff8b3d');
  if (e.type === 'armor-break' && e.id === id) {
    tones([880, 440], { type: 'triangle', vol: 0.03, gap: 0.05, dur: 0.14 });
    $('#vignette').style.boxShadow = 'inset 0 0 120px #4fa8ffaa';
    setTimeout(() => ($('#vignette').style.boxShadow = ''), 200);
  }
  if (e.type === 'chest-refill' && mode !== 'menu') {
    const p = me();
    if (p && Math.hypot(p.x - e.x, p.z - e.z) < 12) toast('A CHEST NEARBY IS FULL AGAIN', '#ffe7a0');
  }
  if (e.type === 'dash' && e.id === id) beep(1);
  if (e.type === 'crit' && e.victim === id) toast('KILLED BY THE TITAN GLOVES', '#e0a33c');
  if (e.type === 'ability' && e.id === id && e.ability === 'summon') toast('TWO HELPER BOTS JOIN YOU FOR 25 s', '#ffb070');
  if (e.type === 'ability' && e.id === id && e.ability === 'freeze') toast('FROST NOVA · EVERYONE AROUND YOU FREEZES', '#8fe3ff');
  if (e.type === 'ability' && e.id === id && e.ability === 'venom') toast('VENOM POOL', '#9bd84a');
  if (e.type === 'ability' && e.id === id && e.ability === 'eruption') toast('ERUPTION · A LINE OF STONE SPIKES', '#d08a3a');
  // A boss close by starts a signature move: name it, so there is a moment to get out of the marked ground.
  if (e.type === 'boss-move') {
    const p = state.players.find((q) => q.id === id);
    if (p && p.hp > 0 && Math.hypot(p.x - e.x, p.z - e.z) < 40) bossWarning(`${BOSSES[e.kind].name} · ${MOVE_LABELS[e.move] || e.move.toUpperCase()}`, BOSSES[e.kind].color);
  }
  if (e.type === 'loot' && e.id === id) {
    const parts = [];
    if (e.weapon !== null) parts.push(`${WEAPONS[e.weapon].consumable ? '' : rarityName(e.rarity) + ' '}${WEAPONS[e.weapon].name} · ${WEAPONS[e.weapon].ru}`);
    if (e.extra !== null && e.extra !== undefined) parts.push(e.extraTaken ? '+ ' + WEAPONS[e.extra].name : WEAPONS[e.extra].name + ' ON THE GROUND');
    if (e.gear) parts.push(GEAR.find((g) => g.id === e.gear)?.name + ' EQUIPPED');
    if (e.tier && e.tier !== 'drop') tones(e.tier === 'legendary' ? [523, 659, 784, 1047] : [587, 740, 880], { vol: 0.03, gap: 0.06, dur: 0.18 });
    toast(parts.length ? parts.join(' · ') : 'SUPPLIES RESTOCKED', e.weapon !== null ? rarityColor(e.rarity) : null);
  }
  if (e.type === 'melee' && e.id === id) {
    beep(7);
    if (e.hit) {
      hit = 0.12;
      beep(0, true);
    }
  }
  if (e.type === 'launch' && e.id === id) beep(1);
  if (e.type === 'heal' && e.id === id) toast('HEALTH +50');
  if (e.type === 'shot' && e.id === id) {
    if (e.weapon !== 1 || Math.random() < 0.2) beep(e.weapon);
    if (e.hit) {
      hit = 0.12;
      beep(0, true);
    }
  }
  if (e.type === 'kill') {
    const a = state.players.find((p) => p.id === e.by) || state.bosses?.find((b) => b.id === e.by),
      b = state.players.find((p) => p.id === e.victim),
      weapon = a && e.by !== e.victim && WEAPONS[e.weapon],
      line = feedLine(a?.name || 'Player', b?.name || 'Player', weapon ? `./icons/${weapon.model}.png` : null, e.by === id || e.victim === id);
    $('#feed').prepend(line);
    while ($('#feed').children.length > 4) $('#feed').lastChild.remove();
    setTimeout(() => line.remove(), 6000);
  }
  // Damage numbers for your own hits, on players and on bosses.
  if (e.type === 'dmg' && e.by === id) damageNumbers.spawn({ ...e, big: state.players.find((p) => p.id === e.id)?.hp <= 0 }, view?.camera);
  if (e.type === 'boss-hit' && e.by === id) damageNumbers.spawn({ id: e.id, n: e.amount, x: e.x, y: e.y, z: e.z }, view?.camera);
}
let bossWarnTimer;
function bossWarning(text, color) {
  const el = $('#bossWarn');
  el.textContent = text;
  el.style.color = '#' + color.toString(16).padStart(6, '0');
  show('#bossWarn', true);
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
  clearTimeout(bossWarnTimer);
  bossWarnTimer = setTimeout(() => show('#bossWarn', false), 1800);
}
// Relic, boss, status and minimap HUD.
const minimap = new Minimap($('#minimap')),
  damageNumbers = new DamageNumbers($('#dmgLayer'));
let minimapClock = 0;
function extrasHud(p, dt) {
  const relic = p.relic && RELICS[p.relic.id];
  show('#relicHud', !!relic);
  ['#ability1Btn', '#ability2Btn'].forEach((sel, k) => {
    const a = relic?.abilities[k];
    show(sel, !!a && p.hp > 0);
    if (a) {
      $(sel).textContent = a.label.split(' ').map((w) => w[0]).join('').slice(0, 2);
      $(sel).classList.toggle('cool', p.relic.cd[k] > 0);
      $(sel).style.borderColor = '#' + relic.color.toString(16).padStart(6, '0');
    }
  });
  if (relic) {
    $('#relicName').textContent = relic.passive ? relic.name + ' · ' + relic.passive : relic.name;
    $('#relicName').style.color = '#' + relic.color.toString(16).padStart(6, '0');
    const html = relic.abilities
      .map((a, k) => {
        const cd = p.relic.cd[k];
        const left = cd <= 0 ? 'READY' : a.once ? 'USED' : cd.toFixed(cd < 10 ? 1 : 0) + ' s';
        return `<div class="${cd > 0 ? 'cool' : ''}"><span><kbd>${['F', 'G'][k]}</kbd> ${a.label}</span><span>${left}</span></div>`;
      })
      .join('');
    if ($('#relicAbilities').innerHTML !== html) $('#relicAbilities').innerHTML = html;
  }
  // DASH: the touch button only appears once the ability is unlocked, and dims while it recharges.
  const hasDash = p.dashCd !== undefined;
  show('#dashBtn', hasDash && p.hp > 0 && touch);
  if (hasDash) {
    $('#dashBtn').classList.toggle('cool', p.dashCd > 0);
    $('#dashBtn').disabled = p.dashCd > 0;
  }
  // The nearest boss in a fight close by gets a bar at the top.
  const boss = (state.bosses || [])
    .filter((b) => b.hp > 0 && Math.hypot(b.x - p.x, b.z - p.z) < 38 && (b.target === p.id || b.hp < b.maxHp))
    .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  show('#bossBar', !!boss);
  if (boss) {
    $('#bossName').textContent = boss.name;
    $('#bossFill').style.width = (boss.hp / boss.maxHp) * 100 + '%';
    $('#bossFill').style.background = '#' + BOSSES[boss.kind].color.toString(16).padStart(6, '0');
  }
  show('#busHud', !!p.inBus || !!p.dropping);
  if (p.inBus && state.bus)
    $('#busText').textContent = `${touch ? '↑ JUMP' : 'SPACE'} · JUMP OUT  ·  ${Math.max(0, Math.ceil(state.bus.duration - state.bus.t))} s`;
  else if (p.dropping) $('#busText').textContent = p.gliding ? 'GLIDING · STEER WITH MOVEMENT' : 'FREE FALL';
  const fb = p.flashback > 0 && p.hp > 0;
  show('#flashbackFx', fb);
  document.body.classList.toggle('flashback', fb);
  show('#frostFx', p.frozen > 0 && p.hp > 0);
  // Caught in a web: strands over the view and a warning the first moment it happens.
  const webbed = p.webbed > 0 && p.hp > 0;
  show('#webFx', webbed);
  if (webbed && !extrasHud.webbed) toast('WEBBED · YOU ARE SLOWED', '#9bd84a');
  extrasHud.webbed = webbed;
  // Speed lines while falling out of the bus or thrusting on the jetpack.
  show('#speedFx', p.hp > 0 && ((!!p.dropping && !p.gliding) || !!p.thrusting));
  $('#speedFx').classList.toggle('fall', !!p.dropping && !p.gliding);
  minimapClock += dt;
  if (minimapClock > 1 / 15 && view.map) {
    minimapClock = 0;
    minimap.setMap(view.map);
    minimap.draw(state, p, angle);
  }
}
// The ring under the crosshair while an item is used, and the buffs running (0.27).
function itemHud(p) {
  const u = p.hp > 0 && p.using ? p.using : null;
  show('#useRing', !!u);
  if (u) {
    const k = 1 - u.t / (u.time || 1),
      w = WEAPONS[u.w];
    $('#useArc').style.strokeDashoffset = String(119.4 * (1 - k));
    $('#useName').textContent = w?.name || '';
    $('#useTime').textContent = u.t.toFixed(1) + ' s';
    $('#useRing').style.setProperty('--rarity', w?.color || '#8fd0ff');
  }
  const chips = [];
  if (p.rush > 0) chips.push(['rush', 'RUSH', p.rush]);
  if (p.stim > 0) chips.push(['stim', 'STIM', p.stim]);
  if (p.regen) chips.push(['regen', 'REGEN', p.regen.left / (p.regen.rate || 1)]);
  const html = chips.map(([k, n, t]) => `<span class="buff ${k}">${n} <b>${Math.ceil(t)}</b></span>`).join('');
  if ($('#buffs').innerHTML !== html) $('#buffs').innerHTML = html;
}
let lastHP = 100;
function hud(dt) {
  if (state.winner !== null && inventoryOpen) toggleInventory(false);
  let p = state.players.find((p) => p.id === id);
  if (!p) return;
  const w = WEAPONS[p.weapon],
    item = p.slots?.[p.slot],
    sec = Math.ceil(state.time);
  // Follow slot changes made by the simulation (pickups, swaps).
  if (p.slots && !p.slots[slot]) slot = p.slot;
  show('#debugBtn', debugging());
  const remaining = state.players.filter((o) => o.bot && o.hp > 0).length;
  $('#timer').textContent =
    state.mode === 'survival'
      ? `${remaining} / ${state.players.filter((o) => o.bot).length}`
      : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('#score').textContent = state.mode === 'survival' ? 'BOTS' : `${p.score} / ${state.scoreLimit || 10}`;
  $('#staminaBar').style.width = p.stamina + '%';
  $('#staminaText').textContent = p.sprinting ? 'SPRINT' : p.stamina < 25 ? 'REST' : 'STAMINA';
  $('#health').textContent = Math.ceil(p.hp);
  $('#healthBar').style.width = p.hp + '%';
  $('#healthBar').classList.toggle('low', p.hp < 35);
  $('#armorNum').textContent = Math.round(p.armor || 0);
  $('#armorBar').style.width = Math.min(100, p.armor || 0) + '%';
  $('#ammo').textContent = w.melee ? '—' : (item?.ammo ?? 0);
  $('#maxAmmo').textContent = w.fists ? ' BARE HANDS' : w.melee ? ' MELEE' : w.consumable ? ' / ' + w.mag : ' / ' + (item?.reserve ?? 0);
  $('#weaponName').textContent = rarityName(p.rarity) + ' · ' + w.name;
  $('#weaponName').style.color = rarityColor(p.rarity);
  const planted = w.sticky ? (state.charges || []).filter((c) => c.owner === p.id).length : 0;
  $('#reloadText').textContent =
    p.reload > 0
      ? `RELOAD ${p.reload.toFixed(1)}`
      : w.spinup && p.spin > 0 && p.spin < 1
        ? 'SPINNING UP'
        : w.consumable
          ? p.using
            ? `USING · ${p.using.t.toFixed(1)} s`
            : `${touch ? '●' : 'LMB'} · USE`
          : w.fists
            ? `${touch ? '●' : 'LMB'} · PUNCH · FIND A WEAPON`
          : w.melee
          ? 'LMB · STRIKE'
          : w.sticky
            ? `${touch ? '⊕' : 'RMB'} · DETONATE${planted ? ' · ' + planted : ''}`
            : touch
              ? '↻ · RELOAD'
              : 'R · RELOAD';
  // Ballistic shield: its own bar, and the flashbang wash-out.
  const guard = p.gear?.id === 'shield' ? p.gear : null,
    guardMax = GEAR.find((g) => g.id === 'shield')?.hp || 1;
  show('#shieldStatus', !!guard);
  if (guard) $('#shieldBar').style.width = Math.max(0, Math.min(100, (guard.hp / guardMax) * 100)) + '%';
  const blind = p.blinded || 0;
  show('#flashFx', blind > 0);
  $('#flashFx').style.opacity = blind > 0 ? Math.min(1, blind / 1.6).toFixed(2) : '0';
  const gear = p.gear && GEAR.find((g) => g.id === p.gear.id);
  show('#gearStatus', !!gear && p.gear.id !== 'shield');
  if (gear) {
    $('#gearName').textContent = p.gliding ? 'GLIDING' : p.thrusting ? 'JETPACK · THRUST' : gear.name;
    $('#gearBar').style.width = (gear.fuel ? (p.gear.fuel / gear.fuel) * 100 : 100) + '%';
  }
  updateInventoryHUD(p);
  itemHud(p);
  ambience(p);
  if (p.hp < lastHP - 1) {
    $('#vignette').style.boxShadow = 'inset 0 0 100px #c33d3766';
    setTimeout(() => ($('#vignette').style.boxShadow = ''), 160);
  }
  lastHP = p.hp;
  document.body.classList.toggle('low-hp', p.hp > 0 && p.hp < 30);
  $('#crosshair').style.left = '50%';
  $('#crosshair').style.top = '50%';
  $('#hitmarker').style.left = '50%';
  $('#hitmarker').style.top = '50%';
  hit = Math.max(0, hit - dt);
  $('#hitmarker').style.opacity = hit > 0 ? '1' : '0';
  $('#hint').style.opacity = performance.now() - startedAt < 12000 ? '1' : '0';
  const alive = state.players.filter((o) => o.hp > 0),
    royale = state.mode === 'royale';
  if (royale) {
    const contenders = state.players.filter((o) => !o.helperOf);
    $('#timer').textContent = contenders.filter((o) => o.hp > 0).length + ' / ' + contenders.length;
    $('#score').textContent = 'ALIVE';
  }
  // Royale's shrinking zone, or the fixed ring of a big-city duel.
  const ring = royale || !!state.zone?.fixed;
  show('#zoneStatus', ring);
  if (ring && state.zone) {
    const outside = Math.hypot(p.x - state.zone.x, p.z - state.zone.z) > state.zone.radius;
    $('#zoneStatus').textContent = (outside ? (royale ? 'OUTSIDE ZONE · ' : 'OUTSIDE THE RING · ') : royale ? 'SAFE ZONE · ' : 'DUEL RING · ') + Math.ceil(state.zone.radius) + ' m';
    $('#zoneStatus').classList.toggle('danger', outside);
  }
  show('#cheatBadge', !!state.cheated);
  extrasHud(p, dt);
  show('#flyDown', !!p.cheats?.flight);
  if (p.cheats?.infinite && !w.melee) {
    $('#ammo').textContent = '∞';
    $('#maxAmmo').textContent = ' / ∞';
  }
  if (mode === 'online')
    $('#netStatus').textContent = performance.now() - lastPacket > 1500 ? 'CONNECTION SLOW' : latency + ' ms';
  const finished = state.winner !== null,
    dead = p.hp <= 0;
  document.body.classList.toggle('dead', dead && !finished);
  show('#announcement', (finished || dead) && !paused && !panel && !inventoryOpen);
  $('#announcement').classList.toggle('spectating', royale && dead && !finished);
  show('#resultActions', finished || (dead && state.mode !== 'classic' && state.mode !== 'duel'));
  show('#returnGroup', finished && mode === 'online' && group?.host === id);
  if (finished) {
    gameplay(false);
    const win = state.winner === id,
      winner = state.players.find((p) => p.id === state.winner);
    $('#announceTitle').textContent = win ? 'YOU MADE IT' : 'MATCH OVER';
    $('#announceText').textContent = win
      ? 'VICTORY'
      : state.winner === 'draw'
        ? 'DRAW'
        : state.mode === 'survival'
          ? 'DEFEAT'
          : winner?.name || 'DEFEAT';
    $('#announceSub').textContent =
      mode === 'online' && group?.public
        ? state.mode === 'duel'
          ? `Rematch in ${Math.ceil(state.intermission)} s`
          : 'Next match starts from the lobby in a few seconds.'
        : mode === 'online'
        ? 'Stay with your group for another match.'
        : state.mode === 'classic' || state.mode === 'duel'
          ? `Next round in ${Math.ceil(state.intermission)} s`
          : 'One life. One more chance next time.';
    $('#replay').disabled = mode === 'online' && (group?.public || group?.host !== id);
    $('#replay').textContent = mode === 'online' && group?.public ? 'AUTO NEXT MATCH' : mode === 'online' && group?.host !== id ? 'WAITING FOR HOST' : 'PLAY AGAIN';
    $('#resultMenu').textContent = mode === 'online' ? 'LEAVE GROUP' : 'BACK TO LOBBY';
    if (rewardedRound !== state.round) {
      rewardedRound = state.round;
      refreshProfile();
      const reward = rewardMatch(profile, {
        kills: p.score,
        win,
        cheated: state.cheated,
        seconds: (performance.now() - startedAt) / 1000,
      });
      const unlockedNames = reward.unlocked.map((id) => COSMETICS.find((c) => c.id === id)?.name).filter(Boolean);
      $('#rewardText').textContent = state.cheated
        ? 'Sandbox match · rewards disabled'
        : reward.coins
          ? `+${reward.coins} COINS   +${reward.xp} PASS XP` +
            (unlockedNames.length ? `   BATTLE PASS TIER ${profile.passTier}: ${unlockedNames.join(', ')}` : '')
          : 'No reward · match shorter than 20 seconds';
      saveProfile();
    }
    if (!resultShown) {
      resultShown = true;
      releaseMouse();
      clearInput();
    }
  } else if (dead) {
    gameplay(false);
    $('#announceTitle').textContent = royale ? 'ELIMINATED' : 'ANOTHER CHANCE';
    $('#announceText').textContent = royale ? 'SPECTATING' : Math.max(1, Math.ceil(p.respawn));
    $('#announceSub').textContent = royale
      ? 'Watching ' + (alive[0]?.name || 'the arena') + ' · match continues'
      : 'Returning to the arena';
    $('#rewardText').textContent = '';
    $('#replay').disabled = mode === 'online';
    $('#replay').textContent = mode === 'online' ? 'MATCH IN PROGRESS' : 'TRY AGAIN';
    if (royale && !resultShown) {
      resultShown = true;
      releaseMouse();
      clearInput();
    }
  } else if (!paused && !inventoryOpen && !panel) {
    resultShown = false;
    gameplay(true);
  }
}

let toastTimer;
function toast(message, color = null) {
  $('#toast').textContent = message;
  $('#toast').style.borderLeftColor = color || 'transparent';
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2800);
}
function toggleInventory(open) {
  if (open && (mode === 'menu' || state.winner !== null || panel)) return;
  inventoryOpen = open;
  clearInput();
  show('#inventory', open);
  if (open) tutorial?.inventoryOpened();
  if (open) {
    releaseMouse();
    gameplay(false);
    $('#closeInventory').focus();
  } else {
    captureMouse();
    gameplay(state.winner === null && !paused && !panel);
  }
}
let inventoryKey = '';
// The relic in the inventory panel: its name and the two abilities on F and G.
function relicRow(p) {
  const r = p.relic && RELICS[p.relic.id];
  if (!r) return '';
  const hex = '#' + r.color.toString(16).padStart(6, '0');
  return `<div class="inventory-weapon relic-row" style="--rarity:${hex}"><span class="slot-no">★</span><i class="gem"></i><div><b>${r.name} · RELIC</b><small>${r.abilities.map((a, k) => `${touch ? '' : ['F', 'G'][k] + ' · '}${a.label}`).join('   ')} · drops if you fall</small></div><span>RELIC</span></div>`;
}
function slotLabel(item) {
  const w = WEAPONS[item.w];
  return w.fists ? 'FISTS' : w.melee ? 'MELEE' : w.consumable ? `× ${item.ammo}` : `${item.ammo} / ${item.reserve}`;
}
// What an item does, in a few words, and what it just did.
const ITEM_DONE = (w) => {
  const e = w.effect || {};
  if (e.armor && e.hp) return 'FULL HEALTH AND ARMOUR';
  if (e.armor) return `+${e.armor} ARMOUR`;
  if (e.regen) return `REGENERATING ${e.regen} OVER ${e.over} s`;
  if (e.speed) return `+${Math.round((e.speed - 1) * 100)} % SPEED FOR ${e.time} s`;
  if (e.stim) return `ENDLESS STAMINA FOR ${e.stim} s`;
  if (e.hp) return `+${e.hp} HEALTH`;
  return w.name + ' SET DOWN';
};
function updateInventoryHUD(p) {
  const barKey = JSON.stringify([p.slots, p.slot]);
  if (barKey !== updateInventoryHUD.bar) {
    updateInventoryHUD.bar = barKey;
    document.querySelectorAll('[data-slot]').forEach((e) => {
      const i = +e.dataset.slot,
        item = p.slots?.[i];
      e.disabled = !item;
      e.classList.toggle('active', p.slot === i);
      e.style.setProperty('--rarity', item ? rarityColor(item.r) : 'transparent');
      const img = e.querySelector('img');
      if (item) img.src = `./icons/${WEAPONS[item.w].model}.png`;
      img.style.visibility = item ? 'visible' : 'hidden';
      e.querySelector('b').textContent = item ? slotLabel(item) : i === 0 ? 'MELEE' : 'EMPTY';
    });
  }
  const relic = p.relic && RELICS[p.relic.id];
  show('#relicSlot', !!relic);
  if (relic) {
    const hex = '#' + relic.color.toString(16).padStart(6, '0'),
      ready = p.relic.cd.some((c) => c <= 0);
    $('#relicSlot').style.setProperty('--rarity', hex);
    $('#relicSlot').classList.toggle('ready', ready);
    $('#relicSlot b').textContent = relic.name.split(' ').slice(-1)[0];
    $('#relicSlot').title = relic.name;
  }
  const vest = p.armorTier ? ARMOR_TIERS.find((a) => a.id === p.armorTier) : null;
  $('#armorLabel').textContent = `MEDKITS ${p.medkits}${vest ? ' · ' + vest.name.toUpperCase() : ''}`;
  const near = (state.chests || []).filter(
    (c) => !c.opened && Math.hypot(c.x - p.x, c.z - p.z) < 2.8 && Math.abs((c.y || 0) - (p.y || 0)) < 1.8 && lineClear(p, c, 0, view.map.obstacles),
  )[0];
  const lift = p.vehicle ? null : nearLift(view.map,p);
  const door = p.vehicle || lift ? null : nearestDoor(view.map, p);
  const vehicle = !door && !lift && !p.vehicle ? nearestVehicle(view.map, p, view.map.vehicles) : null;
  show('#lootPrompt', !!(lift || door || near || vehicle || p.vehicle) && !inventoryOpen && p.hp > 0 && state.winner === null);
  if (near) {
    const what =
      near.kind === 'drop'
        ? near.loot
          ? WEAPONS[near.loot.w].consumable
            ? `PICK UP ${near.ammo ?? WEAPONS[near.loot.w].found ?? 1} × ${WEAPONS[near.loot.w].name}`
            : `PICK UP ${rarityName(near.loot.r)} ${WEAPONS[near.loot.w].name}`
          : 'PICK UP ' + (GEAR.find((g) => g.id === near.gear)?.name || 'SUPPLIES')
        : near.tier === 'supply'
          ? 'OPEN SUPPLY CRATE'
          : near.tier === 'legendary'
            ? 'OPEN LEGENDARY CHEST'
            : near.tier === 'roof'
              ? 'OPEN ROOF CHEST'
              : 'OPEN CHEST';
    $('#lootPrompt').textContent = (touch ? '' : 'E · ') + what;
    $('#lootPrompt').style.borderColor = near.kind === 'drop' && near.loot ? rarityColor(near.loot.r) : 'transparent';
  }
  if (door) {
    $('#lootPrompt').textContent = (touch ? 'TAP USE · ' : 'E · ') + (door.open ? 'CLOSE DOOR' : 'OPEN DOOR') + (door.label ? ' / ' + door.label.slice(0,48) : '');
    $('#lootPrompt').style.borderColor = '#dfc599';
  }
  if (vehicle || p.vehicle) {
    $('#lootPrompt').textContent = (touch ? 'TAP USE · ' : 'E · ') + (p.vehicle ? 'EXIT VEHICLE' : 'ENTER ' + vehicle.kind.toUpperCase());
    $('#lootPrompt').style.borderColor = '#d8c58d';
  }
  if (lift) {
    $('#lootPrompt').textContent = (touch ? 'TAP USE · ' : 'E · ') + (lift.inside ? 'SELECT LIFT FLOOR' : 'CALL LIFT / FLOOR '+lift.floor);
    $('#lootPrompt').style.borderColor = '#a5dac4';
  }
  $('#interactBtn').disabled = !lift && !near && !door && !vehicle && !p.vehicle;
  $('#interactBtn small').textContent = lift ? 'LIFT' : p.vehicle ? 'EXIT' : vehicle ? 'DRIVE' : door ? 'DOOR' : 'LOOT';
  $('#interactBtn').setAttribute('aria-label', door ? (door.open ? 'Close door' : 'Open door') : 'Open supply chest');
  if (p.healing > 0) $('#reloadText').textContent = `HEALING ${p.healing.toFixed(1)} s`;
  if (!inventoryOpen) return;
  $('#inventoryNote').textContent =
    mode === 'online'
      ? 'Online match continues. Equipment lasts until the match ends.'
      : 'Paused. Equipment lasts until the match ends.';
  const gear = p.gear && GEAR.find((g) => g.id === p.gear.id);
  $('#supplyText').textContent =
    `Medkits: ${p.medkits} / 5 · Armor: ${p.armor} / 100 · Gear: ${gear ? gear.name : 'none'}`;
  $('#healBtn').disabled = p.medkits === 0 || p.hp >= 100;
  const key = JSON.stringify([p.slots, p.slot, p.relic?.id]);
  if (key !== inventoryKey) {
    inventoryKey = key;
    $('#inventoryWeapons').innerHTML = p.slots
      .map((item, i) => {
        if (!item)
          return `<button class="inventory-weapon" disabled><span class="slot-no">${i + 1}</span><div><b>Empty slot</b><small>Open chests to find weapons</small></div></button>`;
        const w = WEAPONS[item.w],
          st = weaponStats(item.w, item.r),
          line = w.consumable || w.desc ? `${w.desc || ''} · ${slotLabel(item)}` : w.fists ? 'What everyone starts with. Find a weapon.' : `${Math.round(st.damage)}${w.pellets > 1 ? '×' + w.pellets : ''} dmg · ${slotLabel(item)}`;
        return `<button class="inventory-weapon ${i === p.slot ? 'selected' : ''}" data-equip="${i}" style="--rarity:${rarityColor(item.r)}"><span class="slot-no">${i + 1}</span><img src="./icons/${w.model}.png" alt=""><div><b>${w.name} · ${w.ru}</b><small><em>${rarityName(item.r)}</em> · ${line}</small></div><span>${i === p.slot ? 'EQUIPPED' : 'EQUIP'}</span></button>`;
      })
      .join('') + relicRow(p);
    document.querySelectorAll('[data-equip]').forEach(
      (e) =>
        (e.onclick = () => {
          selectSlot(+e.dataset.equip);
          if (mode === 'training') {
            sim.equip(
              sim.players.find((p) => p.id === id),
              slot,
            );
            state = sim.snapshot();
          }
        }),
    );
  }
  const ctx = $('#districtMap').getContext('2d'),
    map = view.map,
    s = Math.min(416 / (map.limit.x * 2), 352 / (map.limit.z * 2)),
    ox = (416 - map.limit.x * 2 * s) / 2,
    oz = (352 - map.limit.z * 2 * s) / 2,
    px = (x) => ox + (x + map.limit.x) * s,
    pz = (z) => oz + (map.limit.z - z) * s;
  const caption = $('.map-panel small');
  if (caption) caption.textContent = `${map.limit.x * 2} × ${map.limit.z * 2} m · green: parks and hills · beige: quarry · dark: ruins`;
  ctx.fillStyle = '#283e40';
  ctx.fillRect(0, 0, 416, 352);
  ctx.fillStyle = '#7d947a';
  for (const p of map.parks) {
    ctx.fillStyle = ZONE_COLORS[p.type] || '#638661';
    ctx.fillRect(px(p.x - p.w / 2), pz(p.z + p.d / 2), p.w * s, p.d * s);
  }
  ctx.fillStyle = '#75847f';
  for (const r of map.roads) ctx.fillRect(px(r.x - r.w / 2), pz(r.z + r.d / 2), r.w * s, r.d * s);
  for (const r of map.paths) {
    ctx.fillStyle = '#b5ac85';
    ctx.fillRect(px(r.x - r.w / 2), pz(r.z + r.d / 2), r.w * s, r.d * s);
  }
  for (const b of map.buildings) {
    ctx.fillStyle = b.collapsed
      ? '#5f5850'
      : b.category === 'industry'
        ? '#9e8c72'
        : b.category === 'home'
          ? '#95aa89'
          : '#9aaba8';
    ctx.fillRect(px(b.x - b.w / 2), pz(b.z + b.d / 2), b.w * s, b.d * s);
  }
  if (state.zone) {
    ctx.strokeStyle = '#88dcff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px(state.zone.x), pz(state.zone.z), state.zone.radius * s, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const c of state.chests || [])
    if (!c.opened) {
      ctx.fillStyle = '#f0c57a';
      ctx.fillRect(px(c.x) - 2, pz(c.z) - 2, 4, 4);
    }
  for (const o of state.players)
    if (o.hp > 0) {
      ctx.fillStyle = o.id === id ? '#98ffe0' : '#f1907e';
      ctx.beginPath();
      ctx.arc(px(o.x), pz(o.z), o.id === id ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.strokeStyle = '#a0ffe2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px(p.x), pz(p.z));
  ctx.lineTo(px(p.x + Math.sin(angle) * 7), pz(p.z + Math.cos(angle) * 7));
  ctx.stroke();
}
// Keep-alive runs on a timer, not the render loop: browsers pause requestAnimationFrame in hidden tabs
// (e.g. while a player pastes the invite link into a messenger) but only slow timers down.
setInterval(() => {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'ping', sent: performance.now() }));
}, 2000);
// Online: others are drawn a little in the past, smoothly between states (netcode.js Interpolator); you are drawn
// where your own inputs have taken you, replayed on top of the last position the server confirmed (Predictor).
// While a pad, a glider, a knock-back or the bus moves you, you are shown where the server says.
let perkCache = { key: null, speed: 1 };
function predictCtx(me) {
  const key = packSkills(profile.skills);
  if (perkCache.key !== key) perkCache = { key, speed: skillPerks(profile.skills).speed || 1 };
  return { weaponMove: WEAPONS[me.weapon]?.move || 1, perkSpeed: perkCache.speed, carry: carryWeight(me) };
}
function predicted(dt) {
  if (mode !== 'online') return state;
  const shown = interp.apply(state, id),
    me = state.players.find((p) => p.id === id);
  if (!me || me.hp <= 0 || me.escalator || me.lift || me.vehicle || me.inBus || me.dropping || me.gliding || me.launched || me.push || me.frozen > 0 || me.cheats?.flight || !view?.map) {
    predictor.idle(me);
    return shown;
  }
  const pos = predictor.position(me, view.map, predictCtx(me), dt);
  if (!pos) return shown;
  const contact = sweepVehicleContacts(view.map, me, {x:pos.x-me.x,y:pos.y-me.y,z:pos.z-me.z});
  Object.assign(pos,{x:me.x+contact.x,y:me.y+contact.y,z:me.z+contact.z});
  return { ...shown, players: shown.players.map((p) => (p.id === id ? { ...p, x: pos.x, y: pos.y, z: pos.z } : p)) };
}
// ---- Lobby stage ---------------------------------------------------------------------------------
// In the lobby the view shows one character on the stage (lobby-stage.js): you, in what you wear, holding your
// primary — or whatever is being previewed (a wardrobe item under the pointer or picked, a weapon or gear in the
// inventory tab, an emote playing for a few seconds). Drag the character to turn it.
const lobby = { yaw: 0.4, spin: 0, drag: null, preview: null, weapon: null, gear: null, emote: 0, picked: null };
// Party members in a private group stand beside you, the way they will drop in.
const PARTY_SPOTS = [
  [-1.35, -0.55, 0.3],
  [1.35, -0.55, -0.3],
  [-2.55, -1.3, 0.5],
];
function lobbyState(base, party = null) {
  const others = party ?? (group && !group.public ? base.players.filter((q) => q.id !== id && !q.bot).slice(0, 3) : []),
    spot = { ...lobbySpot(base.size), party: others.length },
    menuBox = $('#menu').getBoundingClientRect(),
    // How much of the screen the menu covers: the character stands in the middle of the rest.
    shift = innerWidth > innerHeight * 1.15 ? Math.min(0.7, Math.max(0, menuBox.right / innerWidth)) : 0,
    // Portrait: the menu starts lower down and the character stands in the band above it.
    lift = innerWidth > innerHeight * 1.15 ? 0 : Math.max(0, 1 - Math.min(0.9, menuBox.top / innerHeight)),
    l = profile.loadout,
    gear = lobby.gear ?? l.gear,
    f = spot.face,
    at = (dx, dz) => ({ x: spot.x + Math.cos(f) * dx + Math.sin(f) * dz, y: spot.y, z: spot.z - Math.sin(f) * dx + Math.cos(f) * dz });
  lobby.spin *= 0.9;
  if (!lobby.drag) lobby.yaw += lobby.spin;
  lobbyPlate(shift);
  const stand = { pitch: 0, hp: 100, rarity: 0, grounded: true, moving: 0, shot: 0, slots: [], lowReady: true };
  return {
    ...base,
    lobby: { ...spot, shift, lift },
    projectiles: [],
    charges: [],
    players: [
      {
        ...stand,
        id,
        name: ($('#nickname').value || 'PLAYER').slice(0, 16),
        ...at(0, 0),
        angle: f + lobby.yaw,
        weapon: lobby.weapon ?? l.primary,
        cosmetics: { ...profile.equipped, ...(lobby.preview || {}) },
        emote: lobby.emote > 0 ? 1 : 0,
        gear: gear && gear !== 'none' ? { id: gear, fuel: 100, hp: 100 } : null,
      },
      ...others.map((q, i) => ({
        ...stand,
        id: q.id,
        name: q.name,
        ...at(PARTY_SPOTS[i][0], PARTY_SPOTS[i][1]),
        angle: f + PARTY_SPOTS[i][2],
        weapon: q.weapon ?? 0,
        cosmetics: q.cosmetics,
        emote: 0,
        gear: null,
      })),
    ],
  };
}
// The name plate under your character: name, level and skin, or what is being tried on.
let plateKey = '';
function lobbyPlate(shift) {
  const trying = lobby.preview && COSMETICS.find((c) => c.id === Object.values(lobby.preview)[0]),
    skin = COSMETICS.find((c) => c.id === profile.equipped.operator),
    info = trying
      ? `TRYING ON · ${trying.name.toUpperCase()} · ${COSMETIC_RARITIES[cosmeticRarity(trying)].name}`
      : `LEVEL ${levelOf(profile.skills)} · ${(skin?.name || '').toUpperCase()}`,
    name = ($('#nickname').value || 'PLAYER').slice(0, 16),
    key = [name, info, shift.toFixed(3)].join('|');
  if (key === plateKey) return;
  plateKey = key;
  $('#plateName').textContent = name;
  $('#plateInfo').textContent = info;
  $('#lobbyPlate').style.left = ((shift + 1) / 2) * 100 + 'vw';
}
function previewCosmetic(c) {
  lobby.preview = c ? { [c.kind]: c.id } : null;
  if (c?.kind === 'emote') lobby.emote = 4;
}
$('#game').addEventListener('pointerdown', (e) => {
  if (mode !== 'menu' || panel) return;
  lobby.drag = { x: e.clientX, id: e.pointerId };
  lobby.spin = 0;
});
window.addEventListener('pointermove', (e) => {
  if (!lobby.drag || e.pointerId !== lobby.drag.id) return;
  const dx = e.clientX - lobby.drag.x;
  lobby.drag.x = e.clientX;
  lobby.yaw += dx * 0.012;
  lobby.spin = dx * 0.004;
});
window.addEventListener('pointerup', (e) => {
  if (lobby.drag?.id === e.pointerId) lobby.drag = null;
});
function frame(t) {
  let dt = Math.min((t - last) / 1000 || 0, 0.1);
  last = t;
  acc += dt;
  if (mode === 'training' && !portalAdBusy() && !paused && !inventoryOpen && !panel) {
    while (acc >= 1 / 60) {
      sim.input(id, input());
      sim.step();
      jump = false;
      interact = false; liftFloor033 = undefined;
      detonate = false;
      heal = false;
      emote = false;
      dash = false;
      acc -= 1 / 60;
    }
    state = sim.snapshot();
    const events = sim.drainEvents();
    for (const e of events) handleEvent(e);
    tutorialStep(events, dt);
    reload = false;
  } else acc = 0;
  if (mode === 'online') {
    netTimer += dt;
    if (netTimer >= 1 / 60 && socket?.readyState === 1) {
      // Numbered, so the server can say which inputs it has applied; `interp` is how far in the past others are
      // shown here (the server rewinds its hit checks by that plus the round trip).
      const i = input();
      i.seq = predictor.record(i, netTimer);
      socket.send(JSON.stringify({ type: 'input', input: { ...i, lag: latency, interp: Math.round(interp.delay) } }));
      netTimer = 0;
      reload = false;
      jump = false;
      interact = false; liftFloor033 = undefined;
      detonate = false;
      heal = false;
      emote = false;
      dash = false;
    }
  }
  const player = state.players.find((p) => p.id === id);
  const flight = player?.vehicle && state.vehicles?.find(v => v.id === player.vehicle && v.kind === 'plane');
  // Set a useful initial view once, but never overwrite ongoing mouse control from server state.
  if (frame.vehicleLookId !== (player?.vehicle || null)) {
    frame.vehicleLookId = player?.vehicle || null;
    const ride = player?.vehicle && state.vehicles?.find(v => v.id === player.vehicle);
    if (ride) { angle = ride.angle; pitch = ride.kind === 'plane' ? ride.pitch || 0 : 0; }
  }
  const alive = !!player && player.hp > 0;
  if (mode !== 'menu' && previousAlive !== null && alive !== previousAlive) {
    clearInput();
    if (alive) {
      angle = Math.atan2(-player.x, -player.z);
      pitch = 0;
      // Respawn flash.
      $('#vignette').style.boxShadow = 'inset 0 0 180px #d8fff0cc';
      setTimeout(() => ($('#vignette').style.boxShadow = ''), 260);
    }
  }
  previousAlive = alive;
  const spectated = state.mode === 'royale' && player?.hp <= 0 ? state.players.find((p) => p.hp > 0) : null;
  lobby.emote = Math.max(0, lobby.emote - dt);
  view.update(
    mode === 'menu' ? lobbyState(state) : predicted(dt),
    spectated?.id || id,
    mode === 'training' && (paused || inventoryOpen || panel) ? 0 : dt,
    mode === 'menu',
    { angle: spectated?.angle ?? angle, pitch: spectated?.pitch ?? pitch, aim: aiming && !player?.vehicle },
  );
  updateVehicleHUD(state, player, view, mode === 'menu', paused || inventoryOpen || !!panel);
  engineSound(audio, player?.vehicle ? state.vehicles?.find(v => v.id === player.vehicle) : null, sound && mode !== 'menu' && !paused);
  if (mode !== 'menu') hud(dt);
  else ambience(null);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => view?.resize());
// The graphics driver dropped the game's context (a driver crash or reset, or too little video memory). The
// browser usually hands it back; if it has not within a few seconds it has switched 3D off, and only a reload
// (or a browser restart) helps. Either way the next start uses safer settings, so it does not happen again.
let contextLostTimer = 0;
$('#game').addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  // A tab in the background can lose its context without anything being wrong; only a loss in view counts.
  if (!document.hidden)
    try {
      localStorage.setItem('prida-gl-lost', String(Date.now()));
    } catch {}
  if (mode !== 'menu') pause(true);
  $('#pauseNote').textContent = 'Graphics context lost. Restoring the scene…';
  clearTimeout(contextLostTimer);
  contextLostTimer = setTimeout(() => {
    // In the lobby there is no pause card: the loading screen explains instead.
    if (mode === 'menu')
      return showHelp({
        title: '3D graphics stopped.',
        text: 'The browser switched 3D off after a graphics error. Press TRY AGAIN; if it does not come back, follow the steps below.',
        steps: true,
      });
    $('#pauseNote').textContent =
      'The browser switched 3D off after a graphics error. Reload the page; if this keeps happening, close the browser completely and open it again.';
    show('#reloadPage', true);
  }, 5000);
});
$('#game').addEventListener('webglcontextrestored', () => {
  clearTimeout(contextLostTimer);
  show('#reloadPage', false);
  $('#pauseNote').textContent = 'Graphics restored. You can resume.';
});
$('#reloadPage').onclick = () => location.reload();
function saveProfile(upload = true) {
  try {
    saveStore?.setItem('prida-profile-v1', JSON.stringify(profile));
    if (upload) saveStore?.setItem('prida-profile-saved', String(Date.now()));
    saveAvailable = !!saveStore;
  } catch {
    saveAvailable = false;
  }
  updateWallet();
  if (upload && account && !portalMode()) queueProfileUpload();
}
// ---- Accounts (0.23): the profile and the friend list on the PRIDA server --------------------------------------
// The server is the one this page plays online against (never a made-up address); without one, progress stays on
// this device as before.
let account = null,
  uploadTimer = 0,
  groupDirect = false,
  joinParty = null,
  presence = null,
  presenceTimer = 0,
  inviteTimer = 0;
try {
  account = JSON.parse(localStorage.getItem('prida-account') || 'null');
} catch {}
function apiBase() {
  const ws = serverEndpoint();
  if (!ws) return null;
  try {
    const u = new URL(ws);
    return (u.protocol === 'wss:' ? 'https://' : 'http://') + u.host;
  } catch {
    return null;
  }
}
async function api(method, route, body) {
  const base = apiBase();
  if (!base) throw Error('Accounts live on a PRIDA server. Open the game on its own site, or enter a server under PLAY ONLINE → Server connection.');
  let r;
  try {
    r = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', ...(account?.token ? { authorization: 'Bearer ' + account.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Error('Cannot reach the PRIDA server. A free server can take a minute to wake up: try again.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(j.error || 'The server refused (' + r.status + ').'), { status: r.status });
  return j;
}
function storeAccount() {
  try {
    if (account) localStorage.setItem('prida-account', JSON.stringify(account));
    else localStorage.removeItem('prida-account');
  } catch {}
}
function accountStatus(text) {
  $('#accountStatus').textContent = text || '';
}
function queueProfileUpload() {
  if (portalMode()) return;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(async () => {
    try {
      await api('PUT', '/api/profile', { profile });
    } catch (e) {
      if (e.status === 401) signedOut('Your session ended: log in again to keep saving to your account.');
    }
  }, 1500);
}
function signedOut(note = '') {
  closePresence();
  account = null;
  storeAccount();
  renderAccount();
  accountStatus(note);
}
// Everything the lobby shows from the profile.
function refreshProfileUI() {
  updateWallet();
  renderLoadoutSummary();
  view?.setCosmetics(profile.equipped);
  if (menuTab === 'shop') renderShop();
  if (menuTab === 'skills') renderSkills();
  if (menuTab === 'loadout') renderLoadoutPanel();
}
function renderAccount() {
  if (portalMode()) { portalUi035?.render(); return; }
  $('#accountBtn').textContent = account ? account.name : 'LOG IN';
  show('#accountOut', !account);
  show('#accountIn', !!account);
  if (!account) return;
  $('#accWho').textContent = account.name;
  $('#accCode').textContent = account.code || '—';
  renderFriends();
}
function renderFriends() {
  const list = $('#friendList');
  list.innerHTML = '';
  for (const name of account?.friends || []) {
    const li = document.createElement('li'),
      label = document.createElement('span'),
      state = document.createElement('i'),
      remove = document.createElement('button');
    label.textContent = name;
    const online = friendsOnline.has(name.toLowerCase());
    state.textContent = online ? 'online' : 'offline';
    state.classList.toggle('on', online);
    li.append(label, state);
    if (online) {
      const invite = document.createElement('button');
      invite.className = 'invite';
      invite.textContent = 'INVITE';
      invite.onclick = () => inviteFriend(name);
      li.append(invite);
    }
    remove.textContent = 'REMOVE';
    remove.onclick = () => friendAction({ remove: name });
    li.append(remove);
    list.append(li);
  }
  if (!(account?.friends || []).length) list.innerHTML = '<li><span>No friends yet: share your code.</span></li>';
  renderGroupFriends();
}
// Online friends in a private group's panel, one tap to invite.
function renderGroupFriends() {
  const names = (account?.friends || []).filter((n) => friendsOnline.has(n.toLowerCase())),
    open = !!group && !group.public && names.length > 0;
  show('#groupFriends', open);
  if (!open) return;
  const list = $('#groupFriendList');
  list.replaceChildren();
  for (const name of names) {
    const li = document.createElement('li'),
      label = document.createElement('span'),
      invite = document.createElement('button');
    label.textContent = name;
    invite.textContent = 'INVITE';
    invite.onclick = () => inviteFriend(name);
    li.append(label, invite);
    list.append(li);
  }
}
// Friends online and group invites: while signed in, one small socket to the server (see server.mjs).
function openPresence() {
  if (portalMode()) return;
  clearTimeout(presenceTimer);
  if (presence || !account?.token) return;
  let url;
  try {
    url = validEndpoint(serverEndpoint(), location.protocol === 'https:');
  } catch {
    return;
  }
  url.search = '?presence=1';
  const ws = new WebSocket(url);
  presence = ws;
  ws.onopen = () => ws.send(JSON.stringify({ token: account?.token || '' }));
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === 'friends') {
      friendsOnline.clear();
      for (const n of m.online || []) friendsOnline.add(String(n).toLowerCase());
      renderFriends();
    } else if (m.type === 'invite') showInvite(m);
    else if (m.type === 'invite-sent') friendNote('Invite sent to ' + m.to + '.');
    else if (m.type === 'invite-failed') friendNote(m.to + ' is not online right now.');
  };
  ws.onclose = (e) => {
    if (presence !== ws) return;
    presence = null;
    friendsOnline.clear();
    renderFriends();
    if (e.code === 4003) return signedOut('Your session ended: log in again.');
    if (account) presenceTimer = setTimeout(openPresence, e.code === 4000 ? 60000 : 15000);
  };
  ws.onerror = () => {};
}
function closePresence() {
  clearTimeout(presenceTimer);
  const ws = presence;
  presence = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  friendsOnline.clear();
}
function friendNote(text) {
  accountStatus(text);
  if (group) $('#connectionStatus').textContent = text;
}
function inviteFriend(name) {
  if (!group || group.public) return friendNote('Open a group first: PLAY ONLINE → CREATE GROUP, then invite ' + name + '.');
  if (presence?.readyState !== 1) return friendNote('Still connecting to the server. Try again in a moment.');
  presence.send(JSON.stringify({ type: 'invite', to: name, party: group.code, mode: group.mode, direct: groupDirect }));
}
const MODE_NAMES = { royale: 'Battle Royale', 'royale-city': 'Battle Royale', duel: 'Duel', classic: 'Free for all' };
function showInvite(m) {
  if (group?.code === m.party) return;
  $('#inviteText').textContent = `${m.from} invites you to group ${m.party} (${MODE_NAMES[m.mode] || 'match'}).`;
  $('#inviteJoin').textContent = mode === 'menu' ? 'JOIN' : 'LEAVE MATCH AND JOIN';
  show('#inviteBanner', true);
  clearTimeout(inviteTimer);
  inviteTimer = setTimeout(() => show('#inviteBanner', false), 60000);
  $('#inviteJoin').onclick = () => {
    show('#inviteBanner', false);
    releaseMouse();
    if (socket) disconnect();
    $('#directMode').checked = !!m.direct;
    joinParty?.({ party: m.party });
  };
  playInviteSound();
}
$('#inviteDismiss').onclick = () => show('#inviteBanner', false);
const friendsOnline = new Set();
async function friendAction(body) {
  try {
    const r = await api('POST', '/api/friends', body);
    account.friends = r.friends;
    storeAccount();
    renderFriends();
    if (presence?.readyState === 1) presence.send(JSON.stringify({ type: 'refresh' }));
    accountStatus(body.remove ? 'Removed.' : 'Friend added.');
  } catch (e) {
    accountStatus(e.message);
  }
}
async function signIn(register) {
  if (portalMode()) return;
  const name = $('#accName').value.trim(),
    password = $('#accPass').value;
  accountStatus(register ? 'Creating your account…' : 'Logging in…');
  try {
    const r = await api('POST', register ? '/api/register' : '/api/login', { name, password });
    account = { name: r.name, token: r.token, code: r.code, friends: r.friends || [] };
    storeAccount();
    $('#accPass').value = '';
    if (r.profile) {
      // The account's progress replaces this device's.
      profile = readProfile(r.profile);
      saveProfile(false);
      refreshProfileUI();
      accountStatus('Welcome back, ' + r.name + '. Your progress is loaded.');
    } else {
      // A new account starts from what this device has.
      await api('PUT', '/api/profile', { profile });
      accountStatus(register ? 'Account created. This device’s progress is saved to it.' : 'Signed in. This device’s progress is saved to your account.');
    }
    if (!$('#nickname').value || $('#nickname').value === 'PLAYER') $('#nickname').value = r.name.toUpperCase();
    closePresence();
    openPresence();
  } catch (e) {
    accountStatus(e.message);
  }
  renderAccount();
}
// On start, a signed-in device takes the account's progress if it was saved more recently elsewhere, and sends its
// own otherwise.
async function syncAccount() {
  if (portalMode()) return;
  if (!account || !apiBase()) return;
  try {
    const me = await api('GET', '/api/me');
    Object.assign(account, { friends: me.friends, code: me.code });
    storeAccount();
    let local = 0;
    try {
      local = +saveStore?.getItem('prida-profile-saved') || 0;
    } catch {}
    if (me.profile && (me.saved || 0) > local) {
      profile = readProfile(me.profile);
      saveProfile(false);
      refreshProfileUI();
    } else queueProfileUpload();
    renderAccount();
    openPresence();
  } catch (e) {
    if (e.status === 401) signedOut('');
  }
}
async function openAccount() {
  if (portalMode()) { openPanel('accountPanel'); portalUi035?.render(); return; }
  openPanel('accountPanel');
  renderAccount();
  $('#accountStore').textContent = '';
  if (!apiBase()) return ($('#accountStore').textContent = 'This copy of the game has no PRIDA server to keep accounts on; progress is saved on this device.');
  try {
    const s = await api('GET', '/api/status');
    $('#accountStore').textContent = s.persistent
      ? 'Accounts are kept in the server’s database.'
      : 'This server keeps accounts in a file that is cleared when it restarts (free hosting). Your progress also stays on this device.';
    if (account) {
      const me = await api('GET', '/api/me');
      account.friends = me.friends;
      account.code = me.code;
      storeAccount();
      renderAccount();
    }
  } catch (e) {
    if (e.status === 401) signedOut('Your session ended: log in again.');
    else $('#accountStore').textContent = e.message;
  }
}
$('#accountBtn').onclick = openAccount;
$('#accountForm').onsubmit = (e) => {
  e.preventDefault();
  signIn(false);
};
$('#accRegister').onclick = () => signIn(true);
$('#accLogout').onclick = async () => {
  try {
    await api('POST', '/api/logout', {});
  } catch {}
  signedOut('Logged out. Progress stays on this device.');
};
$('#friendAdd').onclick = () => {
  const code = $('#friendCode').value.trim();
  if (code) friendAction({ code });
  $('#friendCode').value = '';
};
function updateWallet() {
  $('#coinBalance').textContent = profile.coins + ' coins';
  $('#shopBalance').textContent = profile.coins + ' COINS';
  $('#profileStats').textContent = profile.matches + ' matches · ' + profile.wins + ' wins';
  $('#saveStatus').textContent = !saveAvailable
    ? 'Saving unavailable. Progress lasts for this session.'
    : portalStorage()
      ? 'Progress uses CrazyGames Data.'
      : 'Progress is saved on this device.';
}
function refreshProfile() {
  if (!saveStore) return;
  try {
    profile = readProfile(saveStore.getItem('prida-profile-v1'));
  } catch {
    saveStore = null;
    saveAvailable = false;
  }
}
const KIND_LABELS = {
  operator: 'PLAYER SKIN',
  accessory: 'ACCESSORY',
  finish: 'WEAPON COLOUR',
  pattern: 'WEAPON PATTERN',
  charm: 'WEAPON CHARM',
  effect: 'EFFECT',
  emote: 'EMOTE',
};
let wardrobeKind = 'operator';
// Small line icons for the item cards, one per wardrobe slot.
const KIND_ART = {
  operator: '<path d="M12 3c-4 0-7 2.6-7 6.4V12h14V9.4C19 5.6 16 3 12 3z"/><path d="M6 13h12v2.5a6 6 0 0 1-12 0z" opacity=".7"/><path d="M9 21h6" stroke="currentColor" stroke-width="2" fill="none"/>',
  accessory: '<path d="M4 15c0-5 3.6-9 8-9s8 4 8 9z"/><path d="M2 15h20v2H2z" opacity=".7"/>',
  finish: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  pattern: '<path d="M3 5h18v3H3zM3 10.5h18v3H3zM3 16h18v3H3z"/>',
  charm: '<path d="M12 2l2.9 6.2 6.6.6-5 4.5 1.5 6.6L12 16.6 6 19.9l1.5-6.6-5-4.5 6.6-.6z"/>',
  effect: '<path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9zM5 15l.9 2.1L8 18l-2.1.9L5 21l-.9-2.1L2 18l2.1-.9z"/>',
  emote: '<circle cx="12" cy="5" r="2.6"/><path d="M12 8.5l-4.5 3.5 1.2 1.4 2.3-1.7V22h2v-6h.2v6h2V11.7l3.3-4.4-1.6-1.2z"/>',
};
function shopCard(c) {
  const owned = profile.owned.includes(c.id),
    equipped = profile.equipped[c.kind] === c.id,
    picked = lobby.picked === c.id,
    r = cosmeticRarity(c),
    tier = PASS_TIERS.indexOf(c.id),
    cost = equipped
      ? 'EQUIPPED'
      : owned
        ? 'EQUIP'
        : c.pass
          ? tier >= 0
            ? 'PASS TIER ' + (tier + 1)
            : 'BATTLE PASS'
          : picked
            ? profile.coins >= c.price
              ? 'TAP TO BUY · ' + c.price
              : 'NEED ' + (c.price - profile.coins) + ' MORE'
            : c.price + ' COINS';
  return `<button class="shop-item rarity-${r} ${equipped ? 'selected' : ''} ${picked ? 'picked' : ''} ${!owned && c.pass ? 'locked' : ''} ${!owned && !c.pass && profile.coins < c.price ? 'poor' : ''}" data-cosmetic="${c.id}" style="--finish:${c.color};--rar:${COSMETIC_RARITIES[r].color}"><span class="item-art"><svg viewBox="0 0 24 24" aria-hidden="true">${KIND_ART[c.kind] || ''}</svg></span><span class="item-rarity">${COSMETIC_RARITIES[r].name}</span><b>${c.name}</b><small>${KIND_LABELS[c.kind]}</small><span class="item-cost">${cost}</span></button>`;
}
function renderShop() {
  refreshProfile();
  updateWallet();
  $('#wardrobeTabs').innerHTML = KINDS.map(
    (k) => `<button data-kind="${k}" class="${k === wardrobeKind ? 'active' : ''}" role="tab" aria-selected="${k === wardrobeKind}">${KIND_LABELS[k]}</button>`,
  ).join('');
  document.querySelectorAll('[data-kind]').forEach(
    (el) =>
      (el.onclick = () => {
        wardrobeKind = el.dataset.kind;
        lobby.picked = null;
        previewCosmetic(null);
        renderShop();
      }),
  );
  $('#shopItems').innerHTML = itemsOfKind(wardrobeKind).map(shopCard).join('');
  renderPass();
  document.querySelectorAll('[data-cosmetic]').forEach((el) => {
    const c = COSMETICS.find((x) => x.id === el.dataset.cosmetic);
    // Pointing at a card tries it on the character on the stage; leaving it goes back to what is picked.
    el.onpointerenter = el.onfocus = () => previewCosmetic(c);
    el.onpointerleave = el.onblur = () => previewCosmetic(COSMETICS.find((x) => x.id === lobby.picked) || null);
    el.onclick = () => {
      refreshProfile();
      const owned = profile.owned.includes(c.id);
      previewCosmetic(c);
      // Something not yet yours: the first tap picks it (and shows it on you), the second buys it.
      if (!owned && (c.pass || lobby.picked !== c.id || profile.coins < c.price)) {
        lobby.picked = c.id;
        $('#shopMessage').textContent = c.pass
          ? `${c.name} is a battle pass reward. Keep playing to unlock it.`
          : profile.coins < c.price
            ? `${c.name} costs ${c.price} coins: ${c.price - profile.coins} more to go. Coins come from matches, eliminations and wins.`
            : `${c.name} · ${COSMETIC_RARITIES[cosmeticRarity(c)].name}. Tap again to buy it for ${c.price} coins.`;
        return renderShop();
      }
      if (!buyOrEquip(profile, c.id)) return;
      lobby.picked = null;
      saveProfile();
      renderShop();
      view?.setCosmetics(profile.equipped);
      if (socket?.readyState === 1 && group?.phase === 'lobby') socket.send(JSON.stringify({ type: 'appearance', value: profile.equipped }));
      const p = sim?.players.find((p) => p.id === id);
      if (p) {
        p.cosmetics = { ...profile.equipped };
        state = sim.snapshot();
      }
      $('#shopMessage').textContent = owned ? 'Equipped. Cosmetics do not change weapon stats.' : `${c.name} is yours and equipped.`;
    };
  });
}
// Battle pass: thirty tiers, each one a cosmetic, earned by playing. No payments, no premium track.
function renderPass() {
  const tier = passTier(profile.passXp),
    intoTier = profile.passXp % PASS_TIER_XP,
    done = tier >= PASS_TIERS.length;
  $('#passStatus').textContent = done
    ? `TIER ${PASS_TIERS.length} / ${PASS_TIERS.length} · COMPLETE`
    : `TIER ${tier} / ${PASS_TIERS.length} · ${PASS_TIER_XP - intoTier} XP TO THE NEXT REWARD`;
  $('#passFill').style.width = (done ? 100 : (intoTier / PASS_TIER_XP) * 100) + '%';
  $('#passTiers').innerHTML = PASS_TIERS.map((id, i) => {
    const c = COSMETICS.find((x) => x.id === id) || { name: id, color: '#9aa7a3' };
    return `<div class="pass-tier ${i < tier ? 'done' : ''}" style="--finish:${c.color}" title="${KIND_LABELS[c.kind] || ''} · ${c.name}"><i></i><b>${i + 1}</b>${c.name}</div>`;
  }).join('');
}
// The skill tree: two sides, four ranks each, and the abilities that open at ten ranks on a side.
function renderSkills() {
  refreshProfile();
  const level = levelOf(profile.skills);
  $('#skillBalance').textContent = profile.coins + ' COINS';
  $('#levelStats').textContent = `LEVEL ${level} / ${maxLevel()} · ${profile.kills} eliminations`;
  $('#skillTree').innerHTML = BRANCHES.map((b) => {
    const spent = ranksIn(profile.skills, b.id),
      open = spent >= ABILITY_AT;
    const nodes = b.nodes
      .map((n) => {
        const rank = profile.skills?.[n.id] || 0,
          maxed = rank >= n.max,
          price = rankCost(n, rank),
          pips = Array.from({ length: n.max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
        const sign = n.per > 0 ? '+' : '';
        return `<button class="skill-node" data-skill="${n.id}" ${maxed || profile.coins < price ? 'disabled' : ''}><span><b>${n.name}</b><small>${sign}${n.per} % ${n.effect} per rank</small><span class="pips">${pips}</span></span><span class="price">${maxed ? 'MAX' : price + ' COINS'}</span></button>`;
      })
      .join('');
    const abilities = b.abilities
      .map((a) => `<div class="skill-ability ${open ? 'on' : ''}"><b>${a.name}</b> · ${a.text}${open ? '' : ` · ${ABILITY_AT - spent} more ranks`}</div>`)
      .join('');
    return `<div class="skill-branch" style="--branch:${b.color}"><h4>${b.name}</h4><p class="branch-note">${spent} / ${ABILITY_AT} ranks towards the abilities</p>${nodes}${abilities}</div>`;
  }).join('');
  document.querySelectorAll('[data-skill]').forEach(
    (el) =>
      (el.onclick = () => {
        refreshProfile();
        const spent = buyRank(profile, el.dataset.skill);
        if (!spent) return;
        saveProfile();
        renderSkills();
        const p = sim?.players.find((p) => p.id === id);
        if (p) {
          sim.setSkills(p, profile.skills);
          state = sim.snapshot();
        }
        if (socket?.readyState === 1 && group?.phase === 'lobby')
          socket.send(JSON.stringify({ type: 'skills', value: packSkills(profile.skills) }));
        const node = NODES.find((n) => n.id === el.dataset.skill);
        $('#skillMessage').textContent = `${node.name} rank ${profile.skills[node.id]} · −${spent} coins · level ${levelOf(profile.skills)}`;
      }),
  );
}
// Debug sandbox menu: every weapon, gear, supplies, target bots and the usual toggles, one tap each.
function debugGive(what) {
  if (!debugging()) return;
  sim.debugGive(id, what);
  state = sim.snapshot();
  renderDebugPanel();
}
function renderDebugPanel() {
  if (!debugging()) return closePanel();
  const rarity = $('#debugRarity');
  if (!rarity.options.length)
    rarity.innerHTML = RARITIES.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');
  const r = () => +rarity.value || 0;
  $('#debugWeapons').innerHTML = WEAPONS.map(
    (w, i) =>
      `<button data-give="${i}" title="${w.ru}"><img src="./icons/${w.model}.png" alt=""><b>${w.name}</b><small>${w.ru}</small></button>`,
  ).join('');
  $('#debugWeapons')
    .querySelectorAll('[data-give]')
    .forEach((el) => (el.onclick = () => debugGive({ weapon: +el.dataset.give, rarity: r(), ammo: true })));
  $('#debugGear').innerHTML =
    GEAR.map((g) => `<button data-gear="${g.id}"><img src="./icons/${g.model}.png" alt=""><b>${g.name}</b></button>`).join('') +
    '<button data-gear=""><b>NO GEAR</b></button>';
  $('#debugGear')
    .querySelectorAll('[data-gear]')
    .forEach((el) => (el.onclick = () => debugGive({ gear: el.dataset.gear })));
  $('#debugBotCount').textContent = `${state.players.filter((p) => p.bot).length} IN THE MATCH`;
  for (const [key, el] of [
    ['god', 'debugGod'],
    ['flight', 'debugFlight'],
    ['infinite', 'debugInfinite'],
  ]) {
    $('#' + el).checked = cheatSettings[key];
    $('#' + el).onchange = () => {
      cheatSettings[key] = $('#' + el).checked;
      applyCheats();
    };
  }
}
document.addEventListener('prida-vehicle-action', e => {
  if (!canLook()) return;
  if (e.detail === 'use') interact = true;
  if (e.detail === 'service') reload = true;
});
for (const [poi, label] of [['fort','NW / FORT NORTH'],['solara','NW / VILLA SOLARA'],['vista','NW / VILLA VISTA'],['q1:fort','NE / FORT NORTH'],['q2:fort','SW / FORT NORTH'],['q3:fort','SE / FORT NORTH'],['mall','GLASS ARCADE'],['bank','CIVIC BANK'],['courtyard','COURT GARDENS'],['terraces','TERRACE HOUSE']]) {
  const button = document.createElement('button');button.className='secondary';button.type='button';button.textContent='TRAVEL / '+label;
  $('#debugPanel .inventory-card').append(button);
  button.onclick = () => { if (debugging() && sim.debugTravel(id, poi)) {closePanel();angle=Math.PI;pitch=0;} };
}
$('#debugBtn').onclick = () => openPanel('debugPanel');
$('#debugAmmo').onclick = () => debugGive({ ammo: true });
$('#debugSupplies').onclick = () => debugGive({ medkits: 5, armor: 100 });
$('#debugHeal').onclick = () => debugGive({ heal: true });
$('#debugAddBot').onclick = () => {
  if (!debugging()) return;
  sim.debugBots(1);
  state = sim.snapshot();
  renderDebugPanel();
};
$('#debugClearBots').onclick = () => {
  if (!debugging()) return;
  sim.debugBots(0);
  state = sim.snapshot();
  renderDebugPanel();
};
function openPanel(name) {
  if ((name === 'cheatPanel' || name === 'debugPanel') && !developerMode()) return;
  if (mode !== 'menu') pause(true);
  closePanel();
  panelFocus = document.activeElement;
  panel = name;
  show('#' + name, true);
  releaseMouse();
  clearInput();
  if (name === 'cheatPanel') updateCheatPanel();
  if (name === 'debugPanel') renderDebugPanel();
  // Picture settings: keep the scene visible behind the panel.
  if (name === 'picturePanel') {
    show('#pause', false);
    renderGradePanel();
  }
  $('#' + name)
    .querySelector('button,input')
    ?.focus();
}
function closePanel() {
  if (!panel) return;
  show('#' + panel, false);
  if (panel === 'picturePanel' && paused) show('#pause', true);
  panel = null;
  panelFocus?.focus?.();
  panelFocus = null;
}
for (const e of document.querySelectorAll('[data-close]')) e.onclick = closePanel;
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !panel) return;
  const all = [
    ...$('#' + panel).querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary'),
  ].filter((n) => n.getClientRects().length);
  if (!all.length) return;
  const i = all.indexOf(document.activeElement);
  e.preventDefault();
  all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus();
});
// Lobby tabs: Play, Inventory (starting loadout), Cosmetics (shop) and Info.
let menuTab = 'play';
function setTab(name) {
  menuTab = name;
  lobby.picked = lobby.weapon = lobby.gear = null;
  previewCosmetic(null);
  for (const b of document.querySelectorAll('[data-tab]')) {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  }
  for (const p of document.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== name;
  $('#menu').classList.toggle('wide', name === 'loadout' || name === 'shop' || name === 'skills');
  document.body.classList.toggle('menu-wide', name !== 'play');
  if (name === 'shop') renderShop();
  if (name === 'skills') renderSkills();
  if (name === 'loadout') renderLoadoutPanel();
  $('#menu').scrollTop = 0;
}
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => setTab(b.dataset.tab);
$('#walletBtn').onclick = () => setTab('shop');
$('#codesBtn').onclick = $('#pauseCodes').onclick = () => openPanel('cheatPanel');
$('#pictureBtn').onclick = $('#pausePicture').onclick = () => openPanel('picturePanel');
// ---- Picture settings (colour grading) ----------------------------------------------------------
// New players start with the Cinematic look; a saved choice wins.
let grade = startingGrade();
try {
  const saved = JSON.parse(localStorage.getItem('prida-grade') || 'null');
  if (saved) grade = sanitizeGrade(saved);
} catch {}
// Render resolution (share of the display's pixel ratio) and texture size.
let video = { res: 1, tex: 'medium', view: 250 };
try {
  const v = JSON.parse(localStorage.getItem('prida-video') || 'null');
  if (v)
    video = {
      res: [1, 0.85, 0.75, 0.6, 0.5].includes(+v.res) ? +v.res : 1,
      tex: TEXTURE_SIZES[v.tex] ? v.tex : 'medium',
      view: [120, 180, 250, 350, 500].includes(+v.view) ? +v.view : 250,
    };
} catch {}
function applyVideo() {
  view?.setResolution(video.res);
  view?.setViewDistance(video.view);
  setTextureQuality(video.tex);
  try {
    localStorage.setItem('prida-video', JSON.stringify(video));
  } catch {}
}
$('#videoRes').onchange = () => {
  video.res = +$('#videoRes').value;
  applyVideo();
};
$('#videoView').onchange = () => {
  video.view = +$('#videoView').value;
  applyVideo();
};
$('#videoTex').onchange = () => {
  video.tex = $('#videoTex').value;
  applyVideo();
};
function saveGrade() {
  view?.setGrade(grade);
  try {
    localStorage.setItem('prida-grade', JSON.stringify(grade));
  } catch {}
}
function renderGradePanel() {
  $('#videoRes').value = String(video.res);
  $('#videoTex').value = video.tex;
  $('#videoView').value = String(video.view);
  $('#gradePresets').innerHTML = '';
  for (const name of Object.keys(GRADE_PRESETS)) {
    const b = document.createElement('button');
    b.textContent = name.toUpperCase();
    b.onclick = () => {
      grade = sanitizeGrade({ ...DEFAULT_GRADE, ...GRADE_PRESETS[name] });
      saveGrade();
      renderGradePanel();
    };
    $('#gradePresets').append(b);
  }
  const box = $('#gradeSliders');
  box.innerHTML = '';
  for (const [key, label, min, max, step] of GRADE_FIELDS) {
    const row = document.createElement('label'),
      value = document.createElement('b'),
      input = document.createElement('input');
    row.className = 'grade-row';
    row.textContent = label;
    Object.assign(input, { type: 'range', min, max, step, value: grade[key] });
    const fmt = () => (value.textContent = (+grade[key]).toFixed(step < 0.01 ? 3 : 2));
    fmt();
    input.oninput = () => {
      grade[key] = +input.value;
      fmt();
      saveGrade();
    };
    row.append(value, input);
    box.append(row);
  }
}
$('#gradeReset').onclick = () => {
  grade = startingGrade();
  saveGrade();
  renderGradePanel();
};
function updateCheatPanel() {
  show('#codeForm', !cheatUnlocked);
  show('#cheatOptions', cheatUnlocked);
  const online = mode === 'online';
  $('#codeMessage').textContent = online
    ? 'Cheats are disabled in online matches.'
    : 'Solo sandbox only. Cheats disable rewards for the entire match.';
  for (const [key, id] of [
    ['flight', 'cheatFlight'],
    ['infinite', 'cheatInfinite'],
    ['god', 'cheatGod'],
    ['bazooka', 'cheatBazooka'],
  ]) {
    $('#' + id).checked = cheatSettings[key];
    $('#' + id).disabled = online;
  }
}
$('#codeForm').onsubmit = (e) => {
  e.preventDefault();
  if (!developerMode() || mode === 'online') return;
  if ($('#cheatCode').value === '250886') {
    cheatUnlocked = true;
    $('#cheatCode').value = '';
    updateCheatPanel();
  } else if ($('#cheatCode').value === BAZOOKA_CODE) {
    $('#cheatCode').value = '';
    grantBazooka();
  } else $('#codeMessage').textContent = 'Incorrect code.';
};
function grantBazooka() {
  if (!developerMode()) return;
  if (mode === 'online') {
    toast('Cheats are disabled in online matches.');
    return;
  }
  cheatUnlocked = true;
  cheatSettings.bazooka = true;
  applyCheats();
  updateCheatPanel();
  toast(sim?.allowCheats ? 'COMET rocket launcher unlocked · slot 4' : 'Rocket launcher ready for your next solo match');
}
function applyCheats() {
  if (!developerMode()) return;
  if (!sim?.allowCheats) return;
  for (const key of Object.keys(cheatSettings)) sim.setCheat(id, key, cheatSettings[key]);
}
for (const [key, el] of [
  ['flight', 'cheatFlight'],
  ['infinite', 'cheatInfinite'],
  ['god', 'cheatGod'],
  ['bazooka', 'cheatBazooka'],
])
  $('#' + el).onchange = () => {
    if (mode === 'online') return;
    cheatSettings[key] = $('#' + el).checked;
    applyCheats();
  };
$('#resetCheats').onclick = () => {
  for (const key of Object.keys(cheatSettings)) cheatSettings[key] = false;
  applyCheats();
  updateCheatPanel();
};
mountDeveloperSettings();
const debugAmmo033 = document.createElement('button');
debugAmmo033.id = 'debugInfinite033'; debugAmmo033.className = 'secondary';
debugAmmo033.dataset.developerOnly = ''; debugAmmo033.type = 'button';
debugAmmo033.textContent = 'INFINITE AMMO + VEHICLE ROCKETS: OFF';
debugAmmo033.onclick = () => {
  if (!debugging()) return;
  const p = sim.players.find(p => p.id === id); if (!p) return;
  const enabled = !p.cheats.infinite;
  if (sim.setCheat(id, 'infinite', enabled)) {
    cheatSettings.infinite = enabled;
    const checkbox = document.getElementById('debugInfinite'); if (checkbox) checkbox.checked = enabled;
    debugAmmo033.textContent = 'INFINITE AMMO + VEHICLE ROCKETS: ' + (enabled ? 'ON' : 'OFF');
    state = sim.snapshot();
  }
};
document.querySelector('#debugPanel .debug-card')?.append(debugAmmo033);
document.addEventListener('prida-developer-change', e => {
  if (e.detail === true) { if (sim && mode !== 'online') sim.allowCheats = true; return; }
  for (const key of Object.keys(cheatSettings)) { cheatSettings[key] = false; if (sim?.allowCheats) sim.setCheat(id,key,false); }
  if (sim) sim.allowCheats = false;
  cheatUnlocked = false; cheatBuffer = '';
  debugAmmo033.textContent = 'INFINITE AMMO + VEHICLE ROCKETS: OFF';
  if (panel === 'cheatPanel' || panel === 'debugPanel') closePanel();
});
async function boot() {
  try {
    await Promise.all([
      initPhysics(),
      loadAssets((n, total) => ($('#loadStatus').textContent = `Loading models ${n} / ${total}…`)),
      initSDK(),
      loadVehicleModels(),
    ]);
    try {
      saveStore = portalMode() ? portalStorage() : localStorage;
      if (!saveStore && portalMode()) throw new Error('CrazyGames Data is unavailable. Enable SDK Data in the Developer Portal.');
      profile = readProfile(saveStore.getItem('prida-profile-v1'));
    } catch (error) {
      if (portalMode()) throw error;
      saveAvailable = false;
    }
    mountPortalExportLinks();
    if (portalMode()) {
      closePresence(); account = null; clearTimeout(uploadTimer);
      portalUi035 = createPortalUI({
        getProfile: () => profile,
        writeProfile: next => { if (!saveStore) throw new Error('No save store'); saveStore.setItem('prida-profile-v1',JSON.stringify(next)); profile=next; refreshProfileUI(); },
        isLobby: () => mode === 'menu' && !group,
        onIdentityChange: () => { // SDK Data changes account scope; never merge another account's local profile.
          disconnect(); sim?.dispose(); location.reload();
        },
        clearInput, releaseMouse,
        mute: on => {
          if(on){portalSound035={enabled:sound,running:audio?.state==='running'};sound=false;audio?.suspend().catch(()=>{});}
          else if(portalSound035){sound=portalSound035.enabled;if(portalSound035.running)audio?.resume().catch(()=>{});portalSound035=null;}
        },
      });
    }
    view = await startView();
    const safe = safeGraphics();
    view.setGrade(grade);
    applyVideo();
    try {
      const q = localStorage.getItem('blockyard-quality');
      if (['auto', 'fast', 'quality'].includes(q)) {
        $('#quality').value = q;
        view.setQuality(q);
      }
      const c = localStorage.getItem('prida-camera');
      if (c === 'first' || c === 'third') cameraView = c;
    } catch {}
    if (safe) {
      $('#quality').value = 'fast';
      view.setQuality('fast');
    }
    applyCameraView(false);
    $('#cameraView').onchange = () => {
      cameraView = $('#cameraView').value === 'third' ? 'third' : 'first';
      applyCameraView();
    };
    // Compile every material's shaders during loading, so the first match frame does not stall.
    $('#loadStatus').textContent = 'Preparing shaders…';
    try {
      await view.precompile();
    } catch {}
    view.setCosmetics(profile.equipped);
    updateWallet();
    renderLoadoutSummary();
    sim = new Arena({ bots: 9, seed: mapSeed });
    const p = sim.addPlayer('you', 'YOU');
    p.cosmetics = { ...profile.equipped };
    state = sim.snapshot();
    try {
      config = await (await fetch('./config.json')).json();
    } catch {}
    $('#endpoint').value = config.multiplayerUrl === 'auto' ? '' : config.multiplayerUrl || '';
    if (serverEndpoint()) $('#serverNote').textContent = 'Connected to this site’s PRIDA server. You can also enter another address.';
    renderAccount();
    syncAccount();
    portalLoading(false);
    show('#loading', false);
    show('#menu', true);
    offerTutorial();
    requestAnimationFrame(frame);
    const join = (params) => {
      leave();
      openPanel('party');
      if (params.server)
        try {
          $('#endpoint').value = validEndpoint(params.server, location.protocol === 'https:').href;
        } catch {}
      $('#room').value = roomCode(params.party);
      if (params.create || params.party) connectGroup(!!params.create);
    };
    joinParty = join;
    const params = new URLSearchParams(location.search);
    if (params.has('party')) join({ party: params.get('party'), server: params.get('server') });
    portalJoin(join);
  } catch (e) {
    console.error(e);
    startFailed(e);
  }
}
// A browser can refuse a WebGL context for a moment while its graphics process restarts after a driver hiccup:
// ask three times, a second or two apart, before giving up.
async function startView() {
  for (let attempt = 0; ; attempt++)
    try {
      return new View($('#game'));
    } catch (e) {
      if (!e.webgl || attempt >= 2) throw e;
      $('#loadStatus').textContent = 'Waiting for the graphics driver…';
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
}
// After the graphics context was lost last time (a driver crash, or too little video memory), start with lighter
// settings: Fast, at most 75 % resolution, low textures. They are saved like any choice the player makes.
function safeGraphics() {
  let lost = 0;
  try {
    lost = +localStorage.getItem('prida-gl-lost') || 0;
    localStorage.removeItem('prida-gl-lost');
  } catch {}
  if (!lost || Date.now() - lost > 7 * 86400e3) return false;
  video.res = Math.min(video.res, 0.75);
  if (video.tex === 'high' || video.tex === 'medium') video.tex = 'low';
  try {
    localStorage.setItem('blockyard-quality', 'fast');
  } catch {}
  $('#safeNote').hidden = false;
  return true;
}
function startFailed(e) {
  showHelp({ ...glAdvice(e?.webgl ? glSupport() : {}, e), detail: e?.message || String(e) });
}
// The loading screen turned into a help page: what happened, what to try, and a button that reloads.
function showHelp({ title, text, steps, detail = '' }) {
  show('#loading', true);
  $('#loadStatus').textContent = 'Unable to start 3D.';
  $('#startTitle').textContent = title;
  $('#startText').textContent = text;
  $('#startSteps').hidden = !steps;
  $('#startDetail').textContent = detail ? 'Details: ' + detail : '';
  $('#startHelp').hidden = false;
  $('#startRetry').onclick = () => location.reload();
}

boot();
// Development-only hook for automated visual checks; stripped from production builds.
if (import.meta.env?.DEV)
  window.__prida = {
    get sim() {
      return sim;
    },
    get state() {
      return state;
    },
    get socket() {
      return socket;
    },
    get latency() {
      return latency;
    },
    get net() {
      return { delay: interp.delay, gap: interp.gap, jitter: interp.jitter, prediction: { ...predictor.stats }, pending: predictor.pending.length };
    },
    get view() {
      return view;
    },
    selectSlot,
    lobby,
    lobbyState: (party) => lobbyState(state, party),
    frame: (t) => frame(t),
    get flags() {
      return { mode, paused, inventoryOpen, panel, mouse: mouse.down };
    },
    setTab: (name) => setTab(name),
    setLook(a, p = 0) {
      angle = a;
      pitch = p;
    },
  };
// Optional agent interface: the same loadout and training actions as the menu.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  for (const tool of [
    {
      name: 'select_arena_weapon',
      description: 'Select an inventory slot (0 = melee, 1–4 = weapons) during a match.',
      inputSchema: {
        type: 'object',
        properties: { slot: { type: 'integer', minimum: 0, maximum: 4 } },
        required: ['slot'],
        additionalProperties: false,
      },
      execute: ({ slot: n } = {}) => {
        if (!Number.isInteger(n) || n < 0 || n > 4) throw Error('slot must be 0–4');
        selectSlot(n);
        const item = me()?.slots?.[slot];
        return { slot, weapon: item ? WEAPONS[item.w].name : null };
      },
    },
    {
      name: 'start_arena_training',
      description: 'Start a new local match against sixteen bots; resets the existing match.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => {
        if (!view || (!sim && mode === 'menu')) throw Error('Game is not ready');
        train('classic');
        return { mode: 'training', opponents: 16 };
      },
    },
  ])
    try {
      Promise.resolve(
        document.modelContext.registerTool(
          { ...tool, annotations: { readOnlyHint: false, untrustedContentHint: false } },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
}
