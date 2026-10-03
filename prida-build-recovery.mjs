// Recover the known 0.37 upload without dropping the native lift snapshot repair.
// This patch deliberately rejects 0.38 or later installers and local edits.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { repairInstaller } from './prida-network-fix.mjs';

export const RELEASE = '0.37.2';
export const RECOVERED_HASH = 'c8851494e148850593b3bc83e692746ff90d3d7c';
const SUPPORTED = new Set([
  'ad77884ba5afa5c6a709e7bb2b9465e43b1fbd4f', // Original 0.37 upload.
  'be096ebb0dfb5fb5e8cf340e46bf8e34d95f2c9b', // Verified lift repair.
]);
export function blobHash(bytes) {
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
export function recoverBuild(filename, { checkOnly = false } = {}) {
  filename = path.resolve(filename);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Installer must be a regular file.');
  const original = fs.readFileSync(filename), digest = blobHash(original);
  if (digest === RECOVERED_HASH) return { status: 'already-fixed', release: RELEASE };
  if (!SUPPORTED.has(digest)) throw Error('Unsupported or edited installer; not overwriting it: ' + digest);
  const temporary = fs.mkdtempSync(path.join(path.dirname(filename), '.prida-recovery-'));
  const candidate = path.join(temporary, 'prida-update.mjs');
  try {
    fs.writeFileSync(candidate, original);
    repairInstaller(candidate);
    let source = fs.readFileSync(candidate, 'utf8');
    for (const [from, to] of [
      ["const RELEASE='0.37.1';", "const RELEASE='0.37.2';"],
      ["const STATE='.prida-0.37.1';", "const STATE='.prida-0.37.2';"],
      ['0.37.1 · LIFT NETWORK FIX', '0.37.2 · BUILD RECOVERY'],
    ]) {
      if (source.split(from).length !== 2) throw Error('Missing or ambiguous recovery anchor: ' + from);
      source = source.replace(from, to);
    }
    const bytes = Buffer.from(source);
    if (blobHash(bytes) !== RECOVERED_HASH) throw Error('Recovery checksum mismatch; original file retained.');
    if (!checkOnly) {
      // Do not replace a concurrent edit while the temporary file was being verified.
      if (blobHash(fs.readFileSync(filename)) !== digest) throw Error('Installer changed during recovery.');
      fs.writeFileSync(candidate, bytes);
      fs.chmodSync(candidate, stat.mode & 0o777);
      fs.renameSync(candidate, filename);
    }
    return { status: checkOnly ? 'verified' : 'fixed', release: RELEASE };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const result = recoverBuild(path.join(root, 'prida-update.mjs'), { checkOnly: process.argv.includes('--check') });
    console.log('[PRIDA ' + RELEASE + '] Build recovery: ' + result.status);
  } catch (error) {
    console.error('[PRIDA ' + RELEASE + '] ' + error.message);
    process.exitCode = 1;
  }
}
