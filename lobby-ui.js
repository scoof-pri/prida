// 0.28.1 lobby refresh: one PLAY flow and one SETTINGS entry point.
// Existing game buttons and controls are reused so simulation/network behavior stays unchanged.

const $ = (s) => document.querySelector(s);

const style = document.createElement('style');
style.id = 'prida-lobby-refresh-style';
style.textContent = `
body.prida-lobby-refresh:not(.playing) #menu:not(.wide){
  left:4.5vw;top:16vh;width:min(350px,88vw);max-height:80dvh;
  padding-right:8px;
}
body.prida-lobby-refresh:not(.playing) #menu:not(.wide) h1{font-size:42px;margin:13px 0 10px}
body.prida-lobby-refresh:not(.playing) #menu:not(.wide) h1 em{font-size:31px}
body.prida-lobby-refresh:not(.playing) #menu:not(.wide) .menu-tabs{margin-bottom:11px}
body.prida-lobby-refresh:not(.playing) #menu:not(.wide) .menu-tabs button{font-size:10px;padding:9px 4px}
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>.intro,
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>.loadout,
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>.match-options,
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>#train,
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>#online{display:none!important}
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>.lobby-tools{margin-top:10px}
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>.lobby-tools #walletBtn,
body.prida-lobby-refresh:not(.playing) .menu-pane[data-pane="play"]>.lobby-tools #accountBtn{min-height:38px}
#lobbyPlayFlow{margin:8px 0 0}
#lobbyPlayFlow .lobby-flow-step{display:grid;gap:8px}
#lobbyPlayFlow .lobby-flow-step[hidden]{display:none!important}
#lobbyPlayFlow .lobby-main-play{min-height:62px;font-size:18px;letter-spacing:1.5px;box-shadow:0 7px 22px #0002}
#lobbyPlayFlow .lobby-main-play span{font-size:9px;letter-spacing:1.1px}
#lobbyPlayFlow .lobby-branch{min-height:54px;padding:11px 15px;text-align:left}
#lobbyPlayFlow .lobby-branch b{font-size:15px;letter-spacing:1px}
#lobbyPlayFlow .lobby-branch small{display:block;margin-top:3px;color:#c7d8ce;font-size:9px;font-weight:500;letter-spacing:.4px}
#lobbyPlayFlow .lobby-branch.primary small{color:#294044b8}
#lobbyPlayFlow .lobby-flow-head{display:flex;align-items:center;gap:9px;margin:1px 0 2px}
#lobbyPlayFlow .lobby-flow-head button{width:auto;background:#315153;border:1px solid #a9c5b744;border-radius:4px;padding:8px 10px;font-size:9px;font-weight:900;letter-spacing:.7px}
#lobbyPlayFlow .lobby-flow-head b{font-size:10px;letter-spacing:1.8px;color:#ffd79c}
#lobbyPlayFlow .lobby-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
#lobbyPlayFlow .lobby-mode{min-height:72px;background:#254548d9;border:1px solid #b8d5c33b;border-left:4px solid #f5a56c;border-radius:5px;padding:10px 11px;text-align:left;transition:background .12s,transform .12s}
#lobbyPlayFlow .lobby-mode:hover{background:#385b5c;transform:translateY(-1px)}
#lobbyPlayFlow .lobby-mode b{display:block;font-size:11px;letter-spacing:.6px}
#lobbyPlayFlow .lobby-mode small{display:block;margin-top:5px;font-size:8px;line-height:1.35;color:#bcd0c4}
#lobbyPlayFlow .lobby-mode.online{border-left-color:#7fd6b0}
#lobbyPlayFlow .lobby-mode.friends{grid-column:1/-1;border-left-color:#ffd79c}
#lobbySettingsBtn{min-width:90px!important;padding:0 12px!important;font-size:9px!important;letter-spacing:1px!important}
#lobbySettingsLayer{position:fixed;inset:0;z-index:55;background:linear-gradient(90deg,transparent 0 48%,#13292ca6 72%,#13292cd9 100%);display:grid;place-items:start end;padding:74px 28px 24px;backdrop-filter:blur(2px)}
#lobbySettingsLayer[hidden]{display:none!important}
#lobbySettingsCard{width:min(360px,94vw);max-height:calc(100dvh - 96px);overflow:auto;background:#233e42f4;border:1px solid #b8d5c345;border-radius:8px;padding:20px;box-shadow:0 18px 55px #0006;touch-action:pan-y}
#lobbySettingsCard header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
#lobbySettingsCard header div span{display:block;font-size:8px;letter-spacing:1.8px;color:#a8c1b5}
#lobbySettingsCard h2{font-size:25px;margin:4px 0 0}
#lobbySettingsClose{background:#3d5b5b;border-radius:4px;padding:9px 12px}
#lobbySettingsCard .settings-section{border-top:1px solid #ffffff20;padding-top:13px;margin-top:13px}
#lobbySettingsCard .settings-section:first-of-type{border-top:0;padding-top:0;margin-top:0}
#lobbySettingsCard .settings-title{display:block;font-size:9px;font-weight:900;letter-spacing:1.7px;color:#ffd79c;margin-bottom:8px}
#lobbySettingsCard .settings-buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px}
#lobbySettingsCard .settings-buttons button{display:flex;align-items:center;justify-content:center;min-height:42px;margin:0;background:#315153;border:1px solid #a9c5b744;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:.8px}
#lobbySettingsCard .settings-buttons button:hover{background:#446463}
#lobbySettingsCard details.settings{margin:0;color:#d6e1d7}
#lobbySettingsCard details.settings>summary{display:none}
#lobbySettingsCard details.settings label{font-size:9px;letter-spacing:1.1px;color:#bad9cb;margin:9px 0 4px}
#lobbySettingsCard details.settings select{display:block;width:100%;margin:0 0 8px;padding:9px;background:#19383b;color:#f7edd8;border:1px solid #728578;border-radius:4px;font-size:12px}
#lobbySettingsCard details.settings .map-row{margin-top:10px;background:#19383b;padding:8px 9px;border-radius:4px}
#lobbySettingsCard details.settings .map-row button{background:#456765}
#lobbySettingsCard .settings-hint{margin:8px 0 0;color:#a9c2b6;font-size:9px;line-height:1.45}
body.playing #lobbySettingsBtn{display:none!important}
@media(max-width:700px){
  body.prida-lobby-refresh:not(.playing) #menu:not(.wide){left:5vw;top:13vh;width:90vw;max-width:390px;max-height:84dvh}
  #lobbyPlayFlow .lobby-mode-grid{grid-template-columns:1fr}
  #lobbyPlayFlow .lobby-mode.friends{grid-column:auto}
  #lobbySettingsLayer{padding:64px 10px 10px;place-items:start center;background:#13292cb8}
  #lobbySettingsCard{width:min(420px,96vw);max-height:calc(100dvh - 74px)}
}
@media(max-height:520px){
  body.prida-lobby-refresh:not(.playing) #menu:not(.wide){top:56px;max-height:calc(100dvh - 62px)}
  body.prida-lobby-refresh:not(.playing) #menu:not(.wide) h1{display:none}
  #lobbyPlayFlow .lobby-mode{min-height:55px;padding:7px 10px}
  #lobbyPlayFlow .lobby-main-play{min-height:48px}
  #lobbySettingsLayer{padding-top:54px}
  #lobbySettingsCard{max-height:calc(100dvh - 60px);padding:14px}
}
`;
document.head.append(style);
document.body.classList.add('prida-lobby-refresh');

const playPane = $('.menu-pane[data-pane="play"]');
const tools = playPane?.querySelector('.lobby-tools');

if (playPane && tools) {
  const flow = document.createElement('div');
  flow.id = 'lobbyPlayFlow';
  flow.innerHTML = `
    <div class="lobby-flow-step" data-flow-step="home">
      <button id="lobbyMainPlay" class="primary lobby-main-play">PLAY <span>SOLO · ONLINE</span></button>
    </div>
    <div class="lobby-flow-step" data-flow-step="branch" hidden>
      <div class="lobby-flow-head"><button type="button" data-flow-back="home">‹ BACK</button><b>CHOOSE HOW TO PLAY</b></div>
      <button type="button" class="primary lobby-branch" data-flow-open="solo"><span><b>PLAY SOLO</b><small>Battle royale, survival, training, debug or tutorial.</small></span><span>›</span></button>
      <button type="button" class="secondary lobby-branch" data-flow-open="online"><span><b>PLAY ONLINE</b><small>Quick royale, duels or a private group with friends.</small></span><span>›</span></button>
    </div>
    <div class="lobby-flow-step" data-flow-step="solo" hidden>
      <div class="lobby-flow-head"><button type="button" data-flow-back="branch">‹ BACK</button><b>PLAY SOLO · CHOOSE MODE</b></div>
      <div class="lobby-mode-grid">
        <button type="button" class="lobby-mode" data-solo-mode="royale"><b>MINI ROYALE</b><small>10 contenders · shrinking zone · last survivor wins.</small></button>
        <button type="button" class="lobby-mode" data-solo-mode="royale-city"><b>BIG CITY ROYALE</b><small>24 contenders on the large city map.</small></button>
        <button type="button" class="lobby-mode" data-solo-mode="survival"><b>SURVIVAL</b><small>One life against 16 bots.</small></button>
        <button type="button" class="lobby-mode" data-solo-mode="classic"><b>TRAINING</b><small>Respawns · first to 10 eliminations.</small></button>
        <button type="button" class="lobby-mode" data-solo-mode="debug"><b>DEBUG</b><small>Solo sandbox · no storm, timer or rewards.</small></button>
        <button type="button" class="lobby-mode" data-solo-mode="tutorial"><b>TUTORIAL</b><small>Learn movement, loot, combat and items.</small></button>
      </div>
    </div>
    <div class="lobby-flow-step" data-flow-step="online" hidden>
      <div class="lobby-flow-head"><button type="button" data-flow-back="branch">‹ BACK</button><b>PLAY ONLINE · CHOOSE MODE</b></div>
      <div class="lobby-mode-grid">
        <button type="button" class="lobby-mode online" data-online-target="quickRoyale"><b>BIG CITY ROYALE</b><small>Quick match · humans plus BOT fillers.</small></button>
        <button type="button" class="lobby-mode online" data-online-target="quickDuel"><b>DUEL · 1 V 1</b><small>Quick match · first to 5 eliminations.</small></button>
        <button type="button" class="lobby-mode online" data-online-target="quickDuelCity"><b>DUEL · BIG CITY</b><small>1 v 1 inside the 300 m city ring.</small></button>
        <button type="button" class="lobby-mode friends" data-online-party="1"><b>PLAY WITH FRIENDS</b><small>Create or join a private group, choose its mode, then invite friends.</small></button>
      </div>
    </div>`;
  playPane.insertBefore(flow, tools);

  const showStep = (name) => {
    flow.querySelectorAll('[data-flow-step]').forEach((el) => (el.hidden = el.dataset.flowStep !== name));
  };
  $('#lobbyMainPlay').addEventListener('click', () => showStep('branch'));
  flow.querySelectorAll('[data-flow-open]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.flowOpen)));
  flow.querySelectorAll('[data-flow-back]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.flowBack)));
  flow.querySelectorAll('[data-solo-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const mode = $('#gameMode');
      if (!mode) return;
      mode.value = b.dataset.soloMode;
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      $('#train')?.click();
    }),
  );
  const startOnline = (target) => {
    $('#online')?.click();
    requestAnimationFrame(() => $('#' + target)?.click());
  };
  flow.querySelectorAll('[data-online-target]').forEach((b) => b.addEventListener('click', () => startOnline(b.dataset.onlineTarget)));
  flow.querySelector('[data-online-party]')?.addEventListener('click', () => $('#online')?.click());

  document.querySelectorAll('.menu-tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.tab === 'play') showStep('home');
    }),
  );
  const menu = $('#menu');
  if (menu) {
    let wasHidden = menu.classList.contains('hidden');
    new MutationObserver(() => {
      const hidden = menu.classList.contains('hidden');
      if (wasHidden && !hidden) showStep('home');
      wasHidden = hidden;
    }).observe(menu, { attributes: true, attributeFilter: ['class'] });
  }
}

const topActions = $('.top-actions');
if (topActions) {
  const settingsButton = document.createElement('button');
  settingsButton.id = 'lobbySettingsBtn';
  settingsButton.type = 'button';
  settingsButton.textContent = 'SETTINGS';
  settingsButton.setAttribute('aria-haspopup', 'dialog');
  settingsButton.setAttribute('aria-controls', 'lobbySettingsLayer');
  topActions.prepend(settingsButton);

  const layer = document.createElement('section');
  layer.id = 'lobbySettingsLayer';
  layer.hidden = true;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-labelledby', 'lobbySettingsTitle');
  layer.innerHTML = `
    <div id="lobbySettingsCard">
      <header><div><span>PRIDA / LOBBY</span><h2 id="lobbySettingsTitle">SETTINGS</h2></div><button id="lobbySettingsClose" type="button" aria-label="Close settings">✕</button></header>
      <div class="settings-section" id="lobbyGameSettings"><span class="settings-title">GAME & GRAPHICS</span></div>
      <div class="settings-section"><span class="settings-title">DISPLAY & AUDIO</span><div class="settings-buttons" id="lobbySystemSettings"></div></div>
      <div class="settings-section"><span class="settings-title">MORE</span><div class="settings-buttons" id="lobbyMoreSettings"></div><p class="settings-hint">Picture opens colour grading, resolution, view distance and texture quality. Codes remain solo-only where applicable.</p></div>
    </div>`;
  document.body.append(layer);

  const gameSettings = $('.match-options details.settings');
  if (gameSettings) {
    gameSettings.open = true;
    $('#lobbyGameSettings')?.append(gameSettings);
  }

  const sound = $('#sound');
  const fullscreen = $('#fullscreen');
  const system = $('#lobbySystemSettings');
  if (sound) system?.append(sound);
  if (fullscreen) {
    fullscreen.textContent = 'FULLSCREEN';
    fullscreen.setAttribute('aria-label', 'Fullscreen');
    system?.append(fullscreen);
  }

  const more = $('#lobbyMoreSettings');
  const picture = $('#pictureBtn');
  const codes = $('#codesBtn');
  if (picture) more?.append(picture);
  if (codes) more?.append(codes);

  const safeNote = $('#safeNote');
  if (safeNote) safeNote.textContent = 'Graphics were lowered after a graphics crash last time. Open SETTINGS at the top right to raise them again.';

  const openSettings = () => {
    layer.hidden = false;
    settingsButton.setAttribute('aria-expanded', 'true');
    $('#lobbySettingsClose')?.focus({ preventScroll: true });
  };
  const closeSettings = () => {
    layer.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
  };
  settingsButton.addEventListener('click', openSettings);
  $('#lobbySettingsClose')?.addEventListener('click', closeSettings);
  layer.addEventListener('click', (e) => {
    if (e.target === layer) closeSettings();
  });
  picture?.addEventListener('click', closeSettings);
  codes?.addEventListener('click', closeSettings);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && !layer.hidden) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeSettings();
        settingsButton.focus({ preventScroll: true });
      }
    },
    true,
  );

  const menu = $('#menu');
  const syncSettingsButton = () => {
    const lobbyVisible = !!menu && !menu.classList.contains('hidden') && !document.body.classList.contains('playing');
    settingsButton.classList.toggle('hidden', !lobbyVisible);
    if (!lobbyVisible) closeSettings();
  };
  if (menu) new MutationObserver(syncSettingsButton).observe(menu, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(syncSettingsButton).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncSettingsButton();
}
