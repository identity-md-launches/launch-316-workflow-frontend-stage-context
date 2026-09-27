import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { abiHash, safePath } from '../lib/integrity.mjs';
const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root));
const config = JSON.parse(await read('dist/imd-deployment.json'));
const source = JSON.parse(await read('web/deployment.json'));
const network = JSON.parse(await read('web/network.json'));
for (const key of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.equal(config[key], source[key], key);
assert.equal(config.version, 1);
assert.deepEqual(config.network, network.network);
assert.deepEqual(config.walletAddChain, network.walletAddChain);
assert.deepEqual(config.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })), source.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })));
for (const c of config.contracts) {
  assert(safePath(c.abiPath));
  const bytes = await read(`dist/${c.abiPath}`);
  assert.equal(abiHash(JSON.parse(bytes)), c.abiHash);
  const pinned = execFileSync('git', ['show', `${config.sourceCommit}:docs/abi/${c.name}.json`], { cwd: fileURLToPath(root) });
  assert(bytes.equals(pinned));
}
async function files(path) {
  const results = [];
  for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    assert(!(await lstat(new URL(child, root))).isSymbolicLink());
    if (entry.isDirectory()) results.push(...await files(child)); else results.push(child);
  }
  return results;
}
const exported = (await files('dist')).filter(p => p !== 'dist/imd-deployment.json').map(p => p.slice(5)).sort();
assert.deepEqual(config.assets.map(a => a.path).sort(), exported);
assert(exported.includes('index.html'));
assert(exported.length <= 128);
let bytes = (await read('dist/imd-deployment.json')).length;
for (const asset of config.assets) {
  assert(safePath(asset.path)); assert(/^[0-9a-f]{64}$/.test(asset.sha256));
  const data = await read(`dist/${asset.path}`);
  assert(data.length <= 8388608); bytes += data.length;
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, asset.path);
}
assert(bytes < 32 * 1024 * 1024);
assert(!/\b(?:src|href)="\/(?!\/)/.test((await read('dist/index.html')).toString()));
console.log(`PASS: ${exported.length} assets, ${bytes} total export bytes; pinned ABIs, identifiers, network, relative URLs and all SHA-256 hashes match.`);
