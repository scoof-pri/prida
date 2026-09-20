// Offline-registry fallback: installs package-lock.json packages from cdn.jsdelivr.net
// Usage: NODE_USE_ENV_PROXY=1 node scripts/jsdelivr-install.mjs [--dev]
import {readFile, mkdir, writeFile, chmod, symlink, rm} from 'node:fs/promises';
import path from 'node:path';
const dev = process.argv.includes('--dev');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const wanted = Object.entries(lock.packages).filter(([k, v]) => k && (dev || !v.dev) && (!v.optional || /linux-x64(-gnu)?$/.test(k)));
async function get(url, tries = 4) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return r; }
    catch (e) { if (i >= tries) throw e; await new Promise(r => setTimeout(r, 500 * (i + 1))); }
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({length: n}, async () => { while (i < items.length) await fn(items[i++]); })); }
for (const [key, meta] of wanted) {
  const name = key.replace(/^.*node_modules\//, ''), spec = `${name}@${meta.version}`;
  const list = await (await get(`https://data.jsdelivr.com/v1/packages/npm/${spec}?structure=flat`)).json();
  const files = list.files.map(f => f.name);
  await rm(key, {recursive: true, force: true});
  await pool(files, 24, async f => {
    const dest = path.join(key, f); await mkdir(path.dirname(dest), {recursive: true});
    const buf = Buffer.from(await (await get(`https://cdn.jsdelivr.net/npm/${spec}${f}`)).arrayBuffer());
    await writeFile(dest, buf, {mode: /(^|\/)bin\//.test(f) ? 0o755 : 0o644});
  });
  const pkg = JSON.parse(await readFile(path.join(key, 'package.json'), 'utf8'));
  const bins = typeof pkg.bin === 'string' ? {[pkg.name.split('/').pop()]: pkg.bin} : pkg.bin || {};
  for (const [b, rel] of Object.entries(bins)) {
    const target = path.join(key, rel); await chmod(target, 0o755);
    if (key.split('node_modules').length === 2) { await mkdir('node_modules/.bin', {recursive: true}); await rm(`node_modules/.bin/${b}`, {force: true}); await symlink(path.relative('node_modules/.bin', target), `node_modules/.bin/${b}`); }
  }
  console.log('ok', spec, files.length);
}
