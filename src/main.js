import { loadAssets, setTextureQuality, TEXTURE_SIZES } from './assets.js';
import { lineClear } from './world.js';
import { LookInput } from './look-input.js';
import { relativeMove } from './combat.js';
import './style.css';
import { Arena, initPhysics } from './simulation.js';
import { View } from './render.js';
import { WEAPONS, DEFAULT_SEED } from './world.js';
import { initSDK, gameplay, portalStorage, portalInvite, portalRoom, portalJoin } from './sdk.js';
import { COSMETICS, freshProfile, readProfile, buyOrEquip, rewardMatch } from './cosmetics.js';
import { roomCode, newRoomCode, inviteURL, validEndpoint } from './party.js';
import { RARITIES, GEAR } from './catalog.js';
import { LOADOUT_CHOICES, sanitizeLoadout, encodeLoadout, weaponStats } from './items.js';
import { Minimap } from './minimap.js';
import { hostGroup, joinGroup } from './p2p.js';
import { BOSSES, RELICS } from './bosses.js';
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
  heal = false,
  aiming = false;
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
function unlockAudio() {
  if (!audio)
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  audio?.resume().catch(() => {});
}
function clearInput() {
  flyUp = false;
  flyDown = false;
  interact = false;
  heal = false;
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
// ---- Pre-match loadout (lobby) -------------------------------------------------------------------
const LOADOUT_ROWS = [
  ['melee', 'MELEE', 'Always in slot 1. Quick, silent, no ammunition.'],
  ['primary', 'PRIMARY', 'Your main gun, slot 2.'],
  ['secondary', 'SECONDARY', 'Backup weapon, slot 3.'],
  ['gear', 'GEAR', 'Worn on the back. Hold jump in the air.'],
];
function statLine(w) {
  if (w.melee) return `${w.damage} dmg · ${w.range.toFixed(1)} m reach`;
  if (w.mag === 1) return `${w.damage} dmg · single shot · ${w.reserve} spare`;
  return `${w.damage}${w.pellets > 1 ? '×' + w.pellets : ''} dmg · ${w.mag} mag · ${Math.round(60 / w.interval)} rpm`;
}
function loadoutCard(key, value, selected) {
  if (key === 'gear') {
    const g = GEAR.find((g) => g.id === value);
    return `<button class="kit-choice ${selected ? 'selected' : ''}" data-kit="${key}" data-value="${value}"><span class="kit-art">${g ? `<img src="./icons/${g.model}.png" alt="">` : '<i>—</i>'}</span><b>${g ? g.name : 'NO GEAR'}</b><small>${g ? g.desc : 'Travel light.'}</small></button>`;
  }
  const w = WEAPONS[value];
  return `<button class="kit-choice ${selected ? 'selected' : ''}" data-kit="${key}" data-value="${value}"><span class="kit-art"><img src="./icons/${w.model}.png" alt=""></span><b>${w.name}</b><small>${w.ru} · ${statLine(w)}</small></button>`;
}
function renderLoadoutSummary() {
  const l = profile.loadout;
  $('#loadoutSummary').innerHTML = LOADOUT_ROWS.map(([key, label]) => {
    const v = l[key],
      g = key === 'gear' ? GEAR.find((g) => g.id === v) : null,
      icon = key === 'gear' ? (g ? g.model : null) : WEAPONS[v].model;
    return `<button class="kit-slot" data-open-loadout="${key}"><small>${label}</small>${icon ? `<img src="./icons/${icon}.png" alt="">` : '<i>—</i>'}<b>${key === 'gear' ? (g ? g.name : 'NONE') : WEAPONS[v].name}</b></button>`;
  }).join('');
  document.querySelectorAll('[data-open-loadout]').forEach((e) => (e.onclick = () => setTab('loadout')));
}
function renderLoadoutPanel() {
  const l = profile.loadout;
  $('#loadoutRows').innerHTML = LOADOUT_ROWS.map(
    ([key, label, note]) =>
      `<section class="kit-row"><header><b>${label}</b><small>${note}</small></header><div class="kit-grid">${LOADOUT_CHOICES[key].map((v) => loadoutCard(key, v, l[key] === v)).join('')}</div></section>`,
  ).join('');
  document.querySelectorAll('[data-kit]').forEach(
    (e) =>
      (e.onclick = () => {
        const key = e.dataset.kit,
          value = key === 'gear' ? e.dataset.value : +e.dataset.value;
        refreshProfile();
        profile.loadout = sanitizeLoadout({ ...profile.loadout, [key]: value });
        saveProfile();
        renderLoadoutPanel();
        renderLoadoutSummary();
        if (socket?.readyState === 1 && group?.phase === 'lobby')
          socket.send(JSON.stringify({ type: 'loadout', value: encodeLoadout(profile.loadout) }));
      }),
  );
}
$('#weaponBar').innerHTML = [0, 1, 2, 3, 4]
  .map((i) => `<button data-slot="${i}"><span>${i + 1}</span><img alt=""><b></b></button>`)
  .join('');
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
        ? 'DUEL · 1 V 1'
      : m === 'online'
        ? 'ARENA · ' + (group?.code || '')
        : state.mode === 'survival'
          ? 'SURVIVAL · ONE LIFE'
          : 'TRAINING · BOTS';
  slot = player?.slot ?? 1;
  lastSlot = 0;
  inventoryKey = '';
  show('#netStatus', m === 'online');
  $('#connectionStatus').textContent = '';
  $('#feed').replaceChildren();
  gameplay(true);
  captureMouse();
}
function train(kind = $('#gameMode').value) {
  disconnect();
  clearTimeout(connectionTimer);
  sim?.dispose();
  soloKind = kind;
  const city = kind === 'royale-city',
    mode = city ? 'royale' : kind;
  sim = new Arena({
    bots: city ? 23 : mode === 'royale' ? 9 : 16,
    seed: mapSeed,
    mode,
    size: city ? 'city' : 'district',
    allowCheats: true,
    bus: mode === 'royale',
  });
  const p = sim.addPlayer('you', 'YOU');
  p.cosmetics = { ...profile.equipped };
  sim.setLoadout(p, profile.loadout);
  id = 'you';
  applyCheats();
  state = sim.snapshot();
  begin('training');
}
$('#train').onclick = () => train();
$('#gameMode').onchange = () => {
  const k = $('#gameMode').value;
  $('#modeDescription').textContent =
    k === 'royale'
      ? 'You + 9 bots. A shrinking zone. Last survivor wins.'
      : k === 'royale-city'
        ? 'The big city, 8× the district: you + 23 bots, a slower zone. Last survivor wins.'
      : k === 'survival'
        ? 'You against 16 bots. One life each.'
        : 'First to 10 eliminations. Respawns enabled.';
  $('#train span').textContent =
    k === 'royale' ? 'MINI ROYALE · 10 CONTENDERS' : k === 'royale-city' ? 'BIG CITY · 24 CONTENDERS' : k === 'survival' ? 'SURVIVAL · 16 BOTS' : 'TRAINING · RESPAWNS ON';
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
  $('#createGroup').disabled = $('#joinGroup').disabled = $('#quickRoyale').disabled = $('#quickDuel').disabled = on;
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
    url.searchParams.set('operator', profile.equipped.operator);
    url.searchParams.set('finish', profile.equipped.finish);
    url.searchParams.set('loadout', encodeLoadout(profile.loadout));
    // Private groups play directly between browsers by default (the host's computer runs the match); the server
    // only introduces them. Quick match always goes through the server.
    const direct = !queue && $('#directMode').checked && typeof RTCPeerConnection === 'function',
      params = {
        name: $('#nickname').value.slice(0, 16) || 'PLAYER',
        operator: profile.equipped.operator,
        finish: profile.equipped.finish,
        loadout: encodeLoadout(profile.loadout),
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
        state = msg.state;
        group = msg.group;
        $('#connectionStatus').textContent = msg.group?.public
          ? 'Connected. Waiting for players…'
          : 'Connected. Invite friends or start with bots.';
        renderGroup();
      }
      if (msg.type === 'state') {
        const previous = group?.phase,
          previousMatch = group?.match,
          last = state;
        // Unchanged chests / destruction are left out by the server; keep the copies we have.
        for (const key of ['chests', 'destruction']) if (!(key in msg.state) && last?.[key]) msg.state[key] = last[key];
        const mine = msg.self && msg.state.players.find((p) => p.id === id);
        if (mine) mine.slots = msg.self.slots;
        for (const p of msg.state.players) p.slots ||= [];
        state = msg.state;
        group = msg.group;
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
    group.mode === 'duel'
      ? `${group.members.length} / 2 players · first to 5 eliminations`
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
  lobbyShell();
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
  if (!e.repeat && /^Digit[0-9]$/.test(e.code)) {
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
  if (mode === 'menu' || paused) return;
  if (['KeyI', 'KeyM', 'Tab'].includes(e.code)) {
    e.preventDefault();
    if (!e.repeat) toggleInventory(!inventoryOpen);
    return;
  }
  if (inventoryOpen) return;
  keys.add(e.code);
  if (e.code === 'KeyR') reload = true;
  if (e.code === 'KeyE' && !e.repeat) interact = true;
  if (e.code === 'KeyH' && !e.repeat) heal = true;
  if (e.code === 'Space' && !e.repeat) jump = true;
  if (/^Digit[1-5]$/.test(e.code)) selectSlot(+e.code.slice(-1) - 1);
  if (e.code === 'KeyQ' && !e.repeat) selectSlot(lastSlot);
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
    mode !== 'menu' &&
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
$('#game').addEventListener('pointerdown', (e) => {
  if (!canLook()) return;
  if (e.pointerType === 'touch') {
    if (lookPointer === null && e.clientX > innerWidth * 0.35) {
      lookPointer = e.pointerId;
      lookInput.startDrag(e.pointerId, e.clientX, e.clientY);
      $('#game').setPointerCapture(e.pointerId);
    }
    return;
  }
  if (e.button === 2) {
    aiming = true;
    return;
  }
  if (e.button !== 0) return;
  if (document.pointerLockElement !== $('#game')) {
    captureMouse();
    lookInput.startDrag('mouse', e.clientX, e.clientY);
    $('#game').setPointerCapture(e.pointerId);
  }
  mouse.down = true;
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
  if (e.button === 2) aiming = false;
  if (e.pointerType !== 'touch') {
    mouse.down = false;
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
$('#interactBtn').onclick = () => (interact = true);
$('#aimBtn').onclick = () => (aiming = !aiming);
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
function input() {
  const right =
    move.x + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const forward =
    -move.z + (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const world = relativeMove(right, forward, angle);
  return {
    x: canLook() ? world.x : 0,
    z: canLook() ? world.z : 0,
    angle,
    pitch,
    fire: canLook() && (touch ? fireTouch : mouse.down),
    reload: !paused && reload,
    jump: canLook() && jump,
    ascend: canLook()
      ? (flyUp || keys.has('Space') ? 1 : 0) -
        (flyDown || keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight') ? 1 : 0)
      : 0,
    interact: canLook() && interact,
    heal: canLook() && heal,
    ability1: canLook() && (keys.has('KeyF') || abilityTouch[0]),
    ability2: canLook() && (keys.has('KeyG') || abilityTouch[1]),
    sprint: canLook() && (sprintTouch || keys.has('ShiftLeft') || keys.has('ShiftRight')),
    slot,
  };
}
function handleEvent(e) {
  view.event(e);
  if (e.type === 'boss-down') {
    const b = BOSSES[e.kind],
      who = state.players.find((p) => p.id === e.by)?.name;
    toast(`${b.name} · ${b.title} DEFEATED${who ? ' BY ' + who : ''} · ${RELICS[b.relic].name} DROPPED`, '#' + b.color.toString(16).padStart(6, '0'));
  }
  if (e.type === 'relic' && e.id === id) {
    const r = RELICS[e.relic],
      keysLabel = r.abilities.map((a, k) => (touch ? '' : ['F', 'G'][k] + ' · ') + a.label).join('   ');
    toast(`${r.name} · ${keysLabel}`, '#' + r.color.toString(16).padStart(6, '0'));
  }
  if (e.type === 'flashback' && e.id === id) toast('FLASHBACK · YOUR SIGHT IS STUCK IN THE PAST FOR 5 s', '#e9d3ad');
  if (e.type === 'flashback' && e.by === id) toast('FLASHBACK CAST', '#c08cff');
  if (e.type === 'ability' && e.id === id && e.ability === 'summon') toast('TWO HELPER BOTS JOIN YOU FOR 25 s', '#ffb070');
  if (e.type === 'loot' && e.id === id) {
    const parts = [];
    if (e.weapon !== null) parts.push(`${rarityName(e.rarity)} ${WEAPONS[e.weapon].name} · ${WEAPONS[e.weapon].ru}`);
    if (e.gear) parts.push(GEAR.find((g) => g.id === e.gear)?.name + ' EQUIPPED');
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
      b = state.players.find((p) => p.id === e.victim);
    let line = document.createElement('div');
    line.textContent = `${a?.name || 'Player'}  →  ${b?.name || 'Player'}`;
    $('#feed').prepend(line);
    while ($('#feed').children.length > 3) $('#feed').lastChild.remove();
    setTimeout(() => line.remove(), 5000);
  }
}
// Relic, boss, status and minimap HUD.
const minimap = new Minimap($('#minimap'));
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
    $('#relicName').textContent = relic.name;
    $('#relicName').style.color = '#' + relic.color.toString(16).padStart(6, '0');
    const html = relic.abilities
      .map((a, k) => {
        const cd = p.relic.cd[k];
        return `<div class="${cd > 0 ? 'cool' : ''}"><span><kbd>${['F', 'G'][k]}</kbd> ${a.label}</span><span>${cd > 0 ? cd.toFixed(cd < 10 ? 1 : 0) + ' s' : 'READY'}</span></div>`;
      })
      .join('');
    if ($('#relicAbilities').innerHTML !== html) $('#relicAbilities').innerHTML = html;
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
  minimapClock += dt;
  if (minimapClock > 1 / 15 && view.map) {
    minimapClock = 0;
    minimap.setMap(view.map);
    minimap.draw(state, p, angle);
  }
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
  $('#healthBar').style.background = p.hp < 35 ? '#f5a56c' : '#a6e4c4';
  $('#ammo').textContent = w.melee ? '—' : (item?.ammo ?? 0);
  $('#maxAmmo').textContent = w.melee ? ' MELEE' : ' / ' + (item?.reserve ?? 0);
  $('#weaponName').textContent = rarityName(p.rarity) + ' · ' + w.name;
  $('#weaponName').style.color = rarityColor(p.rarity);
  $('#reloadText').textContent =
    p.reload > 0
      ? `RELOAD ${p.reload.toFixed(1)}`
      : w.spinup && p.spin > 0 && p.spin < 1
        ? 'SPINNING UP'
        : w.melee
          ? 'LMB · STRIKE'
          : touch
            ? '↻ · RELOAD'
            : 'R · RELOAD';
  const gear = p.gear && GEAR.find((g) => g.id === p.gear.id);
  show('#gearStatus', !!gear);
  if (gear) {
    $('#gearName').textContent = p.gliding ? 'GLIDING' : p.thrusting ? 'JETPACK · THRUST' : gear.name;
    $('#gearBar').style.width = (gear.fuel ? (p.gear.fuel / gear.fuel) * 100 : 100) + '%';
  }
  updateInventoryHUD(p);
  if (p.hp < lastHP - 1) {
    $('#vignette').style.boxShadow = 'inset 0 0 100px #c33d3766';
    setTimeout(() => ($('#vignette').style.boxShadow = ''), 160);
  }
  lastHP = p.hp;
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
  show('#zoneStatus', royale);
  if (royale) {
    const outside = Math.hypot(p.x - state.zone.x, p.z - state.zone.z) > state.zone.radius;
    $('#zoneStatus').textContent = (outside ? 'OUTSIDE ZONE · ' : 'SAFE ZONE · ') + Math.ceil(state.zone.radius) + ' m';
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
      const coins = rewardMatch(profile, {
        kills: p.score,
        win,
        cheated: state.cheated,
        seconds: (performance.now() - startedAt) / 1000,
      });
      $('#rewardText').textContent = state.cheated
        ? 'Sandbox match · rewards disabled'
        : coins
          ? '+' + coins + ' COINS'
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
function slotLabel(item) {
  const w = WEAPONS[item.w];
  return w.melee ? 'MELEE' : `${item.ammo} / ${item.reserve}`;
}
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
  $('#armorLabel').textContent = `ARMOR ${p.armor} · MEDKITS ${p.medkits}`;
  const near = (state.chests || []).filter(
    (c) => !c.opened && Math.hypot(c.x - p.x, c.z - p.z) < 2.8 && lineClear(p, c, 0, view.map.obstacles),
  )[0];
  show('#lootPrompt', !!near && !inventoryOpen && p.hp > 0 && state.winner === null);
  if (near) {
    const what =
      near.kind === 'drop'
        ? near.loot
          ? `PICK UP ${rarityName(near.loot.r)} ${WEAPONS[near.loot.w].name}`
          : 'PICK UP ' + (GEAR.find((g) => g.id === near.gear)?.name || 'SUPPLIES')
        : near.tier === 'supply'
          ? 'OPEN SUPPLY CRATE'
          : 'OPEN CHEST';
    $('#lootPrompt').textContent = (touch ? '' : 'E · ') + what;
    $('#lootPrompt').style.borderColor = near.kind === 'drop' && near.loot ? rarityColor(near.loot.r) : 'transparent';
  }
  $('#interactBtn').disabled = !near;
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
  const key = JSON.stringify([p.slots, p.slot]);
  if (key !== inventoryKey) {
    inventoryKey = key;
    $('#inventoryWeapons').innerHTML = p.slots
      .map((item, i) => {
        if (!item)
          return `<button class="inventory-weapon" disabled><span class="slot-no">${i + 1}</span><div><b>Empty slot</b><small>Open chests to find weapons</small></div></button>`;
        const w = WEAPONS[item.w],
          st = weaponStats(item.w, item.r);
        return `<button class="inventory-weapon ${i === p.slot ? 'selected' : ''}" data-equip="${i}" style="--rarity:${rarityColor(item.r)}"><span class="slot-no">${i + 1}</span><img src="./icons/${w.model}.png" alt=""><div><b>${w.name} · ${w.ru}</b><small><em>${rarityName(item.r)}</em> · ${Math.round(st.damage)}${w.pellets > 1 ? '×' + w.pellets : ''} dmg · ${slotLabel(item)}</small></div><span>${i === p.slot ? 'EQUIPPED' : 'EQUIP'}</span></button>`;
      })
      .join('');
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
// Online: your own movement is shown ahead of the server by what you did during the last round trip, so walking
// responds at once instead of one ping later. The offset fades as the server catches up, and never goes into walls.
const prediction = { x: 0, z: 0 };
function predicted(dt) {
  const me = mode === 'online' && state.players.find((p) => p.id === id);
  if (!me || me.hp <= 0 || me.inBus || me.frozen > 0 || paused) {
    prediction.x = prediction.z = 0;
    return state;
  }
  const i = input(),
    speed = me.dropping ? 13 : me.gliding ? 10 : (i.sprint && me.stamina > 0 ? 9 : 5.8) * (WEAPONS[me.weapon]?.move || 1),
    rtt = Math.max(0.03, Math.min(0.5, (latency || 60) / 1000)),
    k = Math.exp(-dt / rtt);
  prediction.x = (prediction.x + (i.x || 0) * speed * dt) * k;
  prediction.z = (prediction.z + (i.z || 0) * speed * dt) * k;
  const len = Math.hypot(prediction.x, prediction.z);
  if (len > 2.5) (prediction.x *= 2.5 / len), (prediction.z *= 2.5 / len);
  const to = { x: me.x + prediction.x, z: me.z + prediction.z };
  if (view.map && !lineClear(me, to, 0.3, view.map.obstacles)) {
    prediction.x *= 0.5;
    prediction.z *= 0.5;
    return state;
  }
  return { ...state, players: state.players.map((p) => (p === me ? { ...p, x: to.x, z: to.z } : p)) };
}
function frame(t) {
  let dt = Math.min((t - last) / 1000 || 0, 0.1);
  last = t;
  acc += dt;
  if (mode === 'training' && !paused && !inventoryOpen && !panel) {
    while (acc >= 1 / 60) {
      sim.input(id, input());
      sim.step();
      jump = false;
      interact = false;
      heal = false;
      acc -= 1 / 60;
    }
    state = sim.snapshot();
    for (const e of sim.drainEvents()) handleEvent(e);
    reload = false;
  } else acc = 0;
  if (mode === 'online') {
    netTimer += dt;
    if (netTimer >= 1 / 60 && socket?.readyState === 1) {
      socket.send(JSON.stringify({ type: 'input', input: { ...input(), lag: latency } }));
      netTimer = 0;
      reload = false;
      jump = false;
      interact = false;
      heal = false;
    }
  }
  const player = state.players.find((p) => p.id === id);
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
  view.update(
    predicted(dt),
    spectated?.id || id,
    mode === 'training' && (paused || inventoryOpen || panel) ? 0 : dt,
    mode === 'menu',
    { angle: spectated?.angle ?? angle, pitch: spectated?.pitch ?? pitch, aim: aiming },
  );
  if (mode !== 'menu') hud(dt);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => view?.resize());
$('#game').addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  pause(true);
  $('#pauseNote').textContent = 'Graphics context lost. Restoring the scene…';
});
$('#game').addEventListener('webglcontextrestored', () => {
  $('#pauseNote').textContent = 'Graphics restored. You can resume.';
});
function saveProfile() {
  try {
    saveStore?.setItem('prida-profile-v1', JSON.stringify(profile));
    saveAvailable = !!saveStore;
  } catch {
    saveAvailable = false;
  }
  updateWallet();
}
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
function renderShop() {
  refreshProfile();
  updateWallet();
  $('#shopItems').innerHTML = COSMETICS.map((c) => {
    const owned = profile.owned.includes(c.id),
      equipped = profile.equipped[c.kind] === c.id;
    return `<button class="shop-item ${equipped ? 'selected' : ''}" data-cosmetic="${c.id}" style="--finish:${c.color}" ${!owned && profile.coins < c.price ? 'disabled' : ''}><span class="finish-swatch"></span><small>${c.kind === 'operator' ? 'OPERATOR' : 'ALL-WEAPON FINISH'}</small><b>${c.name}</b><span>${equipped ? 'EQUIPPED' : owned ? 'EQUIP' : c.price + ' COINS'}</span></button>`;
  }).join('');
  document.querySelectorAll('[data-cosmetic]').forEach(
    (el) =>
      (el.onclick = () => {
        refreshProfile();
        if (!buyOrEquip(profile, el.dataset.cosmetic)) return;
        saveProfile();
        renderShop();
        view?.setCosmetics(profile.equipped);
        if (socket?.readyState === 1 && group?.phase === 'lobby')
          socket.send(JSON.stringify({ type: 'appearance', value: profile.equipped }));
        const p = sim?.players.find((p) => p.id === id);
        if (p) {
          p.cosmetics = { ...profile.equipped };
          state = sim.snapshot();
        }
        $('#shopMessage').textContent = 'Equipped. Cosmetics do not change weapon stats.';
      }),
  );
}
function openPanel(name) {
  if (mode !== 'menu') pause(true);
  closePanel();
  panelFocus = document.activeElement;
  panel = name;
  show('#' + name, true);
  releaseMouse();
  clearInput();
  if (name === 'cheatPanel') updateCheatPanel();
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
  for (const b of document.querySelectorAll('[data-tab]')) {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  }
  for (const p of document.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== name;
  $('#menu').classList.toggle('wide', name === 'loadout' || name === 'shop');
  document.body.classList.toggle('menu-wide', name !== 'play');
  if (name === 'shop') renderShop();
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
async function boot() {
  try {
    await Promise.all([
      initPhysics(),
      loadAssets((n, total) => ($('#loadStatus').textContent = `Loading models ${n} / ${total}…`)),
      initSDK(),
    ]);
    try {
      saveStore = portalStorage() || localStorage;
      profile = readProfile(saveStore.getItem('prida-profile-v1'));
    } catch {
      saveAvailable = false;
    }
    view = new View($('#game'));
    view.setGrade(grade);
    applyVideo();
    // Compile every material's shaders during loading, so the first match frame does not stall.
    $('#loadStatus').textContent = 'Preparing shaders…';
    try {
      await view.renderer.compileAsync(view.scene, view.camera);
      await view.renderer.compileAsync(view.weaponScene, view.weaponCamera);
    } catch {}
    view.setCosmetics(profile.equipped);
    updateWallet();
    renderLoadoutSummary();
    try {
      const q = localStorage.getItem('blockyard-quality');
      if (['auto', 'fast', 'quality'].includes(q)) {
        $('#quality').value = q;
        view.setQuality(q);
      }
    } catch {}
    sim = new Arena({ bots: 9, seed: mapSeed });
    const p = sim.addPlayer('you', 'YOU');
    p.cosmetics = { ...profile.equipped };
    state = sim.snapshot();
    try {
      config = await (await fetch('./config.json')).json();
    } catch {}
    $('#endpoint').value = config.multiplayerUrl === 'auto' ? '' : config.multiplayerUrl || '';
    if (serverEndpoint()) $('#serverNote').textContent = 'Connected to this site’s PRIDA server. You can also enter another address.';
    show('#loading', false);
    show('#menu', true);
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
    const params = new URLSearchParams(location.search);
    if (params.has('party')) join({ party: params.get('party'), server: params.get('server') });
    portalJoin(join);
  } catch (e) {
    $('#loadStatus').textContent = 'Unable to start 3D. A WebGL 2 browser is required. ' + e.message;
    console.error(e);
  }
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
    get view() {
      return view;
    },
    selectSlot,
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
