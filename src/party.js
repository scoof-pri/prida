export function roomCode(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24)
    .toUpperCase();
}
export function newRoomCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');
}
export function inviteURL(base, room, endpoint) {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('party', roomCode(room));
  if (endpoint) u.searchParams.set('server', endpoint);
  return u.href;
}
export function validEndpoint(value, secure = false) {
  const u = new URL(value);
  if (!['ws:', 'wss:'].includes(u.protocol) || u.username || u.password)
    throw Error('Enter a ws:// or wss:// server address.');
  if (secure && u.protocol !== 'wss:') throw Error('This page requires a secure wss:// server.');
  return u;
}
