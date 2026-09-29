// Accounts for the PRIDA server (0.23): register and log in with a name and a password, keep the profile (coins,
// wardrobe, battle pass, skills, loadout) and the friend list on the server, reach them from any device.
//
// Passwords are hashed with scrypt and a random salt per account and compared in constant time; a login hands out a
// random session token, and only its SHA-256 is stored. Nothing secret is ever sent to the client except the
// player's own session token.
//
// Storage. A free Render web service has no persistent disk: a plain file is wiped by every deploy and restart. So
// the store is chosen by the environment:
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  → an Upstash Redis database (free tier, over HTTPS)
//   otherwise                                          → data/accounts.json next to the server (resets on Render),
//                                                        or the file named by PRIDA_ACCOUNTS_FILE
// The server reports which one it uses on /health and /api/status, and the client says so on the account panel.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { readProfile } from './src/cosmetics.js';

const scrypt = (password, salt) =>
  new Promise((resolve, reject) => scryptCb(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, key) => (e ? reject(e) : resolve(key))));
export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const SESSION_DAYS = 30,
  MAX_BODY = 32 * 1024,
  MAX_PROFILE = 24 * 1024,
  MAX_FRIENDS = 100;

// ——— Stores: get / set (with an optional lifetime in seconds) / del, values are strings ———
export function fileStore(file) {
  let data = null,
    writing = Promise.resolve();
  const load = async () => {
    if (data) return data;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      data = {};
    }
    return data;
  };
  const save = () =>
    (writing = writing.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, file);
    }));
  return {
    kind: 'file',
    persistent: false,
    async get(k) {
      const d = await load(),
        e = d[k];
      if (!e) return null;
      if (e.exp && e.exp < Date.now()) {
        delete d[k];
        return null;
      }
      return e.v;
    },
    async set(k, v, ttl = 0) {
      (await load())[k] = { v, exp: ttl ? Date.now() + ttl * 1000 : 0 };
      await save();
    },
    async del(k) {
      delete (await load())[k];
      await save();
    },
  };
}
export function upstashStore(url, token, fetchImpl = globalThis.fetch) {
  const call = async (cmd) => {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw Error('store: ' + (j.error || r.status));
    return j.result;
  };
  return {
    kind: 'upstash',
    persistent: true,
    get: (k) => call(['GET', k]),
    set: (k, v, ttl = 0) => call(ttl ? ['SET', k, v, 'EX', String(ttl)] : ['SET', k, v]),
    del: (k) => call(['DEL', k]),
  };
}
export function storeFromEnv(env = process.env, dir = '.') {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return upstashStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  return fileStore(env.PRIDA_ACCOUNTS_FILE || path.join(dir, 'data', 'accounts.json'));
}

// ——— Rate limit: a bucket per key (address, or address + name) ———
function limiter(limit, windowMs, now) {
  const hits = new Map();
  return (key) => {
    const t = now(),
      list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (hits.size > 5000) hits.clear();
    list.push(t);
    hits.set(key, list);
    return list.length <= limit;
  };
}

// The account service. `handle(req, res, pathname)` answers /api/* and returns true when it did.
export function createAccounts({ store, now = Date.now, origins = [], onChange = () => {} } = {}) {
  const tries = limiter(20, 10 * 60e3, now),
    writes = limiter(120, 60e3, now);
  const userKey = (name) => 'user:' + name.toLowerCase(),
    sessKey = (token) => 'sess:' + createHash('sha256').update(token).digest('hex');
  const readUser = async (name) => {
    const raw = await store.get(userKey(name));
    return raw ? JSON.parse(raw) : null;
  };
  const writeUser = (u) => store.set(userKey(u.name), JSON.stringify(u));
  const newSession = async (name) => {
    const token = randomBytes(24).toString('base64url');
    await store.set(sessKey(token), JSON.stringify({ name, at: now() }), SESSION_DAYS * 86400);
    return token;
  };
  // Who a request is: the account behind its bearer token, or null.
  const whoIs = async (req) => {
    const m = /^Bearer ([A-Za-z0-9_-]{16,64})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const raw = await store.get(sessKey(m[1]));
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { user: await readUser(s.name), token: m[1] };
  };
  const view = (u) => ({ name: u.name, profile: u.profile || null, saved: u.saved || 0, friends: u.friends || [], code: u.code });
  const api = {
    async register({ name, password }) {
      name = String(name || '').trim();
      if (!NAME_RE.test(name)) return [400, { error: 'Names are 3–16 letters, digits or _.' }];
      if (typeof password !== 'string' || password.length < 6 || password.length > 72) return [400, { error: 'Passwords are 6–72 characters.' }];
      if (await readUser(name)) return [409, { error: 'That name is taken.' }];
      const salt = randomBytes(16),
        hash = await scrypt(password, salt),
        user = { name, salt: salt.toString('base64'), hash: hash.toString('base64'), created: now(), profile: null, friends: [], code: friendCode() };
      await writeUser(user);
      await store.set('code:' + user.code, user.name);
      return [200, { token: await newSession(name), ...view(user) }];
    },
    async login({ name, password }) {
      name = String(name || '').trim();
      const user = NAME_RE.test(name) ? await readUser(name) : null;
      // The same work and the same answer whether or not the name exists.
      const salt = user ? Buffer.from(user.salt, 'base64') : randomBytes(16),
        hash = await scrypt(String(password || ''), salt),
        ok = !!user && timingSafeEqual(hash, Buffer.from(user.hash, 'base64'));
      if (!ok) return [401, { error: 'Wrong name or password.' }];
      return [200, { token: await newSession(user.name), ...view(user) }];
    },
  };
  const friendCode = () => {
    const bytes = randomBytes(8);
    return [...bytes].map((n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');
  };
  const send = (res, status, body, origin) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  };
  const body = (req) =>
    new Promise((resolve, reject) => {
      let size = 0,
        chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(Object.assign(Error('too large'), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(Object.assign(Error('bad json'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/')) return false;
    const origin = !origins.length ? '*' : origins.includes(req.headers.origin) ? req.headers.origin : origins[0];
    if (req.method === 'OPTIONS') {
      send(res, 204, {}, origin);
      return true;
    }
    const address = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    try {
      if (pathname === '/api/status' && req.method === 'GET') {
        send(res, 200, { accounts: true, store: store.kind, persistent: store.persistent }, origin);
      } else if ((pathname === '/api/register' || pathname === '/api/login') && req.method === 'POST') {
        const b = await body(req);
        if (!tries(address) || !tries(address + ':' + String(b.name || '').toLowerCase())) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' }, origin), true;
        const [status, out] = await api[pathname === '/api/register' ? 'register' : 'login'](b);
        send(res, status, out, origin);
      } else {
        const me = await whoIs(req);
        if (!me?.user) return send(res, 401, { error: 'Log in again.' }, origin), true;
        const u = me.user;
        if (pathname === '/api/me' && req.method === 'GET') send(res, 200, view(u), origin);
        else if (pathname === '/api/profile' && req.method === 'PUT') {
          if (!writes(u.name)) return send(res, 429, { error: 'Slow down.' }, origin), true;
          const b = await body(req),
            clean = readProfile(b.profile),
            text = JSON.stringify(clean);
          if (text.length > MAX_PROFILE) return send(res, 413, { error: 'Profile too large.' }, origin), true;
          u.profile = clean;
          u.saved = now();
          await writeUser(u);
          send(res, 200, { ok: true, saved: u.saved }, origin);
        } else if (pathname === '/api/logout' && req.method === 'POST') {
          await store.del(sessKey(me.token));
          send(res, 200, { ok: true }, origin);
        } else if (pathname === '/api/friends' && req.method === 'POST') {
          // Add a friend by their friend code, or remove one by name.
          const b = await body(req);
          if (!writes(u.name)) return send(res, 429, { error: 'Slow down.' }, origin), true;
          u.friends ||= [];
          if (b.remove) u.friends = u.friends.filter((f) => f.toLowerCase() !== String(b.remove).toLowerCase());
          else {
            const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const name = code ? await store.get('code:' + code) : null;
            if (!name) return send(res, 404, { error: 'No player has that friend code.' }, origin), true;
            if (name.toLowerCase() === u.name.toLowerCase()) return send(res, 400, { error: 'That is your own code.' }, origin), true;
            if (!u.friends.some((f) => f.toLowerCase() === name.toLowerCase())) {
              if (u.friends.length >= MAX_FRIENDS) return send(res, 400, { error: 'Your friend list is full.' }, origin), true;
              u.friends.push(name);
            }
          }
          await writeUser(u);
          onChange(u.name);
          send(res, 200, view(u), origin);
        } else send(res, 404, { error: 'Unknown request.' }, origin);
      }
    } catch (e) {
      send(res, e.status || 500, { error: e.status ? e.message : 'Server error.' }, origin);
      if (!e.status) console.error('accounts:', e.message);
    }
    return true;
  }
  return { handle, whoIs, readUser, store, sessionName: async (token) => JSON.parse((await store.get(sessKey(token))) || 'null')?.name || null };
}
