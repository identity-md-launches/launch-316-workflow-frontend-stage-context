import { defineChain, isAddress, type Abi, type Address, type Chain } from 'viem';
import { abiHash, safePath } from '../lib/integrity.mjs';

export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: {
    chainId: `0x${string}`; chainName: string; rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[];
  };
};
export type Runtime = {
  deployment: Deployment; chain: Chain;
  token: { address: Address; abi: Abi }; escrow: { address: Address; abi: Abi };
};
async function json(path: string) {
  if (!safePath(path)) throw Error('The deployment contains an unsafe asset path.');
  const response = await fetch(new URL(path, document.baseURI), { cache: 'no-cache' });
  if (!response.ok) throw Error(`Could not load ${path}. Reload the page to retry.`);
  return response.json();
}
export async function loadRuntime(): Promise<Runtime> {
  const deployment = await json('imd-deployment.json') as Deployment;
  if (deployment.version !== 1 || !Number.isSafeInteger(deployment.chainId)
    || deployment.chainId !== deployment.network?.chainId
    || Number(deployment.walletAddChain?.chainId) !== deployment.chainId
    || deployment.contracts?.length !== 2 || !deployment.network.rpcUrls.length) {
    throw Error('Deployment configuration is incomplete or inconsistent. Transactions are disabled.');
  }
  const loaded = await Promise.all(['LaunchToken', 'ArbiterEscrow'].map(async name => {
    const matches = deployment.contracts.filter(c => c.name === name);
    const entry = matches[0];
    if (matches.length !== 1 || !isAddress(entry.address) || !/^[0-9a-f]{64}$/.test(entry.abiHash)) throw Error(`Invalid ${name} configuration.`);
    const abi = await json(entry.abiPath) as Abi;
    if (!Array.isArray(abi) || abiHash(abi) !== entry.abiHash) throw Error(`${name} ABI verification failed. Transactions are disabled.`);
    return { address: entry.address, abi };
  }));
  const { network } = deployment;
  const chain = defineChain({
    id: deployment.chainId, name: network.name, testnet: network.testnet,
    nativeCurrency: network.nativeCurrency, rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: `${network.name} explorer`, url: network.explorer } },
  });
  return { deployment, chain, token: loaded[0], escrow: loaded[1] };
}
