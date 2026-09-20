let sdk = null,
  running = false;
export async function initSDK() {
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
      setTimeout(() => reject(new Error('SDK timeout')), 3000);
    });
    if (!window.CrazyGames?.SDK) return;
    await Promise.race([
      window.CrazyGames.SDK.init(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('init timeout')), 3000)),
    ]);
    sdk = window.CrazyGames.SDK;
    if (running) sdk.game.gameplayStart();
  } catch {
    /* Training and self-hosted builds remain playable without the portal SDK. */
  }
}
export function gameplay(on) {
  if (running === on) return;
  running = on;
  try {
    sdk?.game[on ? 'gameplayStart' : 'gameplayStop']();
  } catch {}
}
// Portal integration is optional outside CrazyGames; no network calls block gameplay.
export function portalStorage() {
  try {
    return sdk?.environment === 'crazygames' ? sdk.data : null;
  } catch {
    return null;
  }
}
export function portalInvite(params) {
  try {
    return sdk?.environment === 'crazygames' ? sdk.game.inviteLink(params) : null;
  } catch {
    return null;
  }
}
export function portalRoom(room, server) {
  try {
    if (!room) {
      sdk?.game.leftRoom();
      return;
    }
    sdk?.game.updateRoom({
      roomId: server + '#' + room.code,
      isJoinable: room.phase === 'lobby' && room.members.length < 10,
      inviteParams: { party: room.code, server },
    });
  } catch {}
}
export function portalJoin(handler) {
  try {
    sdk?.game.addJoinRoomListener(handler);
    if (sdk?.game.inviteParams) handler(sdk.game.inviteParams);
    else if (sdk?.game.isInstantMultiplayer) handler({ create: true });
  } catch {}
}
