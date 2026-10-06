// PRIDA 0.35: CrazyGames HTML5 SDK v3. Native accounts remain separate on self-hosted builds.
// The public portal build uses CrazyGames Data for guests AND signed-in users, never a second local save.
export const PORTAL_BUILD = import.meta.env?.VITE_CG_PORTAL === '1';
export const PORTAL_FULL_ADS = import.meta.env?.VITE_CG_ADS === 'full';
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const harmless = (fn) => { try { return fn?.(); } catch { return undefined; } };
const withTimeout = (promise, ms, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), ms);
  Promise.resolve(promise).then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});
export class PortalBridge {
  constructor({ sdk = null, fullAds = false, allowDemo = false } = {}) {
    this.sdk = sdk; this.fullAds = fullAds; this.allowDemo = allowDemo;
    this.ready = false; this.user = null; this.busy = false; this.desiredPlay = false;
    this.sentPlay = false; this.listeners = new Set(); this.hooks = {};
    this.generation = 0; this.blockedAds = false;
  }
  get active() { return this.ready && (this.sdk?.environment === 'crazygames' || (this.allowDemo && this.sdk?.environment === 'local')); }
  get demo() { return this.sdk?.environment === 'local'; }
  get accountsAvailable() { return this.active && this.sdk?.user?.isUserAccountAvailable === true; }
  get adsAvailable() { return this.active && this.fullAds && !!this.sdk?.ad?.requestAd && !this.blockedAds; }
  get storage() { return this.active ? this.sdk?.data ?? null : null; }
  async initialize() {
    if (!this.sdk) return false;
    await this.sdk.init(); this.ready = true;
    if (!this.active) return false;
    if (this.accountsAvailable) {
      this.sdk.user.addAuthListener?.(user => this.acceptUser(user));
      this.acceptUser(await this.sdk.user.getUser(), false);
    }
    this.syncPlay(); return true;
  }
  acceptUser(user, changed = true) {
    this.user = user || null;
    if (changed) this.generation++;
    for (const listener of this.listeners) harmless(() => listener(this.user, changed));
  }
  onUser(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async login() {
    if (!this.accountsAvailable || this.busy) throw new Error('CrazyGames sign-in is unavailable here.');
    if (this.user) return this.user;
    // Only called by the guest's explicit sign-in button. Never an automatic auth prompt.
    const user = await this.sdk.user.showAuthPrompt();
    if (user && !this.user) this.acceptUser(user);
    return user;
  }
  gameplay(on) { this.desiredPlay = !!on; this.syncPlay(); }
  syncPlay() {
    const on = this.active && this.desiredPlay && !this.busy;
    if (on === this.sentPlay) return;
    harmless(() => this.sdk?.game?.[on ? 'gameplayStart' : 'gameplayStop']()); this.sentPlay = on;
  }
  load(on) { if (this.active) harmless(() => this.sdk.game[on ? 'loadingStart' : 'loadingStop']()); }
  setHooks(hooks) { this.hooks = hooks || {}; }
  requestRewarded() {
    if (!this.adsAvailable) return Promise.resolve({ finished: false, reason: 'unavailable' });
    if (this.busy) return Promise.resolve({ finished: false, reason: 'busy' });
    this.busy = true; const generation = this.generation; this.syncPlay();
    harmless(() => this.hooks.block?.(true));
    return new Promise(resolve => {
      let settled = false, started = false;
      const finish = (finished, reason) => {
        if (settled) return;
        settled = true; this.busy = false;
        if (started) harmless(() => this.hooks.mute?.(false));
        harmless(() => this.hooks.block?.(false)); this.syncPlay();
        resolve({ finished: !!finished && generation === this.generation && !this.demo,
          reason: this.demo ? 'demo' : generation !== this.generation ? 'account-changed' : reason });
      };
      const callbacks = {
        adStarted: () => { if (!settled && !started) { started = true; harmless(() => this.hooks.mute?.(true)); } },
        adFinished: () => finish(true, 'finished'),
        adError: error => { const reason = String(error?.code || error?.message || 'no-ad');
          if (/disabled|not.?supported|adblock/i.test(reason)) this.blockedAds = true;
          finish(false, reason);
        },
      };
      try {
        // v3 user/data use promises; v3 ads still use these lifecycle callbacks.
        const pending = this.sdk.ad.requestAd('rewarded', callbacks);
        pending?.catch?.(callbacks.adError);
      } catch (error) { callbacks.adError(error); }
    });
  }
}
export const portal = new PortalBridge({ fullAds: PORTAL_FULL_ADS, allowDemo: PORTAL_BUILD });
let initPromise;
export function initSDK() {
  return initPromise ??= (async () => {
    try {
      if (!globalThis.CrazyGames?.SDK) await withTimeout(new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = SDK_URL; script.async = true;
        script.onload = resolve; script.onerror = () => reject(new Error('CrazyGames SDK failed to load.'));
        document.head.append(script);
      }), PORTAL_BUILD ? 12000 : 3000, 'CrazyGames SDK download timed out.');
      portal.sdk = globalThis.CrazyGames?.SDK;
      await withTimeout(portal.initialize(), PORTAL_BUILD ? 15000 : 3000, 'CrazyGames initialization timed out.');
      portal.load(true);
      if (PORTAL_BUILD && !portal.active) throw new Error('Open this portal build in CrazyGames Preview. The standalone build remains available on Render.');
    } catch (error) {
      if (PORTAL_BUILD) throw error; // do not silently overwrite a portal cloud save with a fresh local profile
      console.info('[PRIDA] Standalone mode: portal integration is unavailable.');
    }
  })();
}
export const gameplay = on => portal.gameplay(on);
export const portalStorage = () => portal.storage;
export const portalMode = () => PORTAL_BUILD || portal.active;
export const portalAdBusy = () => portal.busy;
export const portalLoading = on => portal.load(on);
export const portalInvite = params => portal.active ? harmless(() => portal.sdk.game.inviteLink(params)) : null;
export function portalRoom(room, server) {
  if (!portal.active) return;
  harmless(() => !room ? portal.sdk.game.leftRoom() : portal.sdk.game.updateRoom({
    roomId: server + '#' + room.code, isJoinable: room.phase === 'lobby' && room.members.length < 10,
    inviteParams: { party: room.code, server },
  }));
}
export function portalJoin(handler) {
  if (!portal.active) return;
  harmless(() => { portal.sdk.game.addJoinRoomListener(handler);
    if (portal.sdk.game.inviteParams) handler(portal.sdk.game.inviteParams);
    else if (portal.sdk.game.isInstantMultiplayer) handler({ create: true });
  });
}
