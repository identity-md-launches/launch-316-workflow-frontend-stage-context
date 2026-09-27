import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { abiHash } from '../lib/integrity.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(root, 'dist');
const handoff = JSON.parse(await readFile(resolve(root, 'web/deployment.json'), 'utf8'));
const { network, walletAddChain } = JSON.parse(await readFile(resolve(root, 'web/network.json'), 'utf8'));
if (network.chainId !== handoff.chainId || Number(walletAddChain.chainId) !== handoff.chainId) throw Error('Chain mismatch');
if (!/^[0-9a-f]{40}$/.test(handoff.sourceCommit)) throw Error('Invalid source commit');
const contracts = [];
await mkdir(resolve(dist, 'abi'), { recursive: true });
for (const contract of handoff.contracts) {
  if (!/^[A-Za-z0-9_]+$/.test(contract.name)) throw Error('Invalid contract name');
  const path = `docs/abi/${contract.name}.json`;
  const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:${path}`], { cwd: root });
  const local = await readFile(resolve(root, path));
  if (!pinned.equals(local)) throw Error(`${path} differs from deployed source commit`);
  const abi = JSON.parse(pinned.toString());
  if (!Array.isArray(abi) || abiHash(abi) !== contract.abiHash) throw Error(`${contract.name}: ABI hash mismatch`);
  const abiPath = `abi/${contract.name}.json`;
  await writeFile(resolve(dist, abiPath), pinned);
  contracts.push({ name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath });
  console.log(`${contract.name}: pinned ABI verified (${contract.abiHash})`);
}
async function inventory(dir) {
  const assets = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if ((await lstat(path)).isSymbolicLink()) throw Error('Symlinks are not allowed in the export');
    if (entry.isDirectory()) assets.push(...await inventory(path));
    else if (path !== resolve(dist, 'imd-deployment.json')) {
      const data = await readFile(path);
      if (data.length > 8388608) throw Error('Asset exceeds 8 MiB');
      assets.push({ path: relative(dist, path), sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
  return assets;
}
const assets = (await inventory(dist)).sort((a,b) => a.path.localeCompare(b.path));
if (assets.length > 128) throw Error('Too many export assets');
const { launchId, chainId, sourceCommit, attestationHash } = handoff;
const config = { version: 1, launchId, chainId, sourceCommit, attestationHash, contracts, assets, network, walletAddChain };
await writeFile(resolve(dist, 'imd-deployment.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`Exported runtime deployment manifest with ${assets.length} SHA-256 assets.`);
