import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
const root = new URL('../../', import.meta.url);
const config = JSON.parse(await readFile(new URL('dist/imd-deployment.json', root), 'utf8'));
const abi = {};
for (const c of config.contracts) abi[c.name] = JSON.parse(await readFile(new URL(`dist/${c.abiPath}`, root), 'utf8'));
const report = { checkedAt: new Date().toISOString(), sourceCommit: config.sourceCommit, endpoints: [] };
for (const url of config.network.rpcUrls) {
  const client = createPublicClient({ transport: http(url, { timeout: 10000, retryCount: 0 }) });
  try {
    const chainId = await client.getChainId();
    if (chainId !== config.chainId) throw Error('Wrong chain ID');
    const code = [];
    for (const c of config.contracts) {
      const bytes = await client.getCode({ address: c.address });
      if (!bytes || bytes === '0x') throw Error(`${c.name}: empty runtime`);
      code.push({ name: c.name, address: c.address, runtimeBytes: (bytes.length - 2) / 2 });
    }
    const escrow = config.contracts.find(c => c.name === 'ArbiterEscrow');
    const token = config.contracts.find(c => c.name === 'LaunchToken');
    const boundToken = await client.readContract({ address: escrow.address, abi: abi.ArbiterEscrow, functionName: 'token' });
    if (boundToken.toLowerCase() !== token.address.toLowerCase()) throw Error('Wrong token binding');
    const count = await client.readContract({ address: escrow.address, abi: abi.ArbiterEscrow, functionName: 'escrowCount' });
    const decimals = await client.readContract({ address: token.address, abi: abi.LaunchToken, functionName: 'decimals' });
    report.endpoints.push({ url, ok: true, chainId, code, boundToken, decimals, escrowCount: count.toString() });
  } catch (error) { report.endpoints.push({ url, ok: false, error: error.shortMessage ?? error.message }); }
}
await mkdir(new URL('docs/frontend/', root), { recursive: true });
await writeFile(new URL('docs/frontend/live-read-check.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.endpoints.some(e => e.ok)) process.exitCode = 1;
