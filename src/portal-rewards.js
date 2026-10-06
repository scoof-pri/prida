// Client-side cosmetic economy, not a server-verifiable ad receipt or anti-cheat system.
// CrazyGames adFinished is the reward signal. Local SDK demo responses NEVER grant production rewards.
export const REWARD_OFFERS = Object.freeze([
  { id: 'credits', title: '100 COINS', detail: 'Watch one ad to receive 100 coins.', coins: 100 },
  { id: 'hazmat', title: 'HAZMAT SKIN', detail: 'Watch one ad to unlock this skin permanently.', cosmetic: 'hazmat' },
  { id: 'crouchdance', title: 'SQUAT DANCE', detail: 'Watch one ad to unlock this emote permanently.', cosmetic: 'crouchdance' },
]);
export const REWARD_COOLDOWN_MS = 120000;
export function cleanReceipts(value) {
  const ledger = value && typeof value === 'object' ? value : {};
  return { at: Number.isFinite(ledger.at) ? Math.max(0, ledger.at) : 0,
    ids: Array.isArray(ledger.ids) ? ledger.ids.filter(x => typeof x === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(x)).slice(-32) : [] };
}
export function newRewardId(cryptoImpl=globalThis.crypto) {
  if(typeof cryptoImpl?.randomUUID==='function')return cryptoImpl.randomUUID();
  if(!cryptoImpl?.getRandomValues)throw new Error('Secure random numbers are unavailable.');
  const bytes=cryptoImpl.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
export class RewardController {
  constructor({ portal, getProfile, writeProfile, now = Date.now, makeId = () => newRewardId() }) {
    Object.assign(this, { portal, getProfile, writeProfile, now, makeId });
    this.pending = null; this.inFlight = false;
  }
  remaining() { return Math.max(0, cleanReceipts(this.getProfile()?.portalRewards).at + REWARD_COOLDOWN_MS - this.now()); }
  async request(offerId, eligible) {
    const offer = REWARD_OFFERS.find(o => o.id === offerId), p = this.getProfile();
    if (!offer || this.inFlight || this.pending || !eligible || !p || p.matches < 1 || this.remaining() > 0)
      return { ok: false, reason: 'not-ready' };
    if (offer.cosmetic && p.owned?.includes(offer.cosmetic)) return { ok: false, reason: 'owned' };
    this.inFlight = true;
    try {
      const id = this.makeId(), generation = this.portal.generation;
      const result = await this.portal.requestRewarded();
      if (!result.finished) return { ok: false, reason: result.reason };
      this.pending = { id, offer, generation };
      return this.commit();
    } finally { this.inFlight = false; }
  }
  commit() {
    if (!this.pending) return { ok: false, reason: 'no-pending-reward' };
    if (this.pending.generation !== this.portal.generation) { this.pending = null; return { ok: false, reason: 'account-changed' }; }
    const { id, offer } = this.pending, profile = structuredClone(this.getProfile());
    const ledger = cleanReceipts(profile.portalRewards);
    if (ledger.ids.includes(id)) { this.pending = null; return { ok: true, duplicate: true }; }
    if (offer.coins) profile.coins = Math.min(1e7, Math.max(0, profile.coins || 0) + offer.coins);
    if (offer.cosmetic) profile.owned = [...new Set([...(profile.owned || []), offer.cosmetic])];
    profile.portalRewards = { at: this.now(), ids: [...ledger.ids, id].slice(-32) };
    try { this.writeProfile(profile); this.pending = null; return { ok: true, offer: offer.id }; }
    catch { return { ok: false, reason: 'save-failed', retry: true }; }
  }
}
