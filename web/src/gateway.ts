import { createPublicClient, createWalletClient, custom, fallback, http, type Address, type EIP1193Provider, type Hash, type Transport } from 'viem';
import type { Runtime } from './config';
import { same, roleOf, unknownChain, type Escrow } from './domain';
export type Provider = EIP1193Provider;
export type Snapshot = {
  balance: bigint; allowance: bigint; withdrawable: bigint; decimals: number; symbol: string;
  count: bigint; escrows: Escrow[]; scanned: number; block: bigint; timestamp: bigint;
};
export function gateway(runtime: Runtime, provider?: Provider) {
  const transports: Transport[] = runtime.deployment.network.rpcUrls.map(url => http(url, { timeout: 6000, retryCount: 0 }));
  if (provider) transports.push(custom(provider, { retryCount: 0 }));
  const client = createPublicClient({ chain: runtime.chain, transport: fallback(transports, { retryCount: 0 }), pollingInterval: 2000 });
  async function verify() {
    const [chainId, tokenCode, escrowCode, token] = await Promise.all([
      client.getChainId(), client.getCode({ address: runtime.token.address }), client.getCode({ address: runtime.escrow.address }),
      client.readContract({ ...runtime.escrow, functionName: 'token' }),
    ]);
    if (chainId !== runtime.deployment.chainId) throw Error('The RPC returned the wrong chain. Transactions are disabled; try refreshing.');
    if (!tokenCode || tokenCode === '0x' || !escrowCode || escrowCode === '0x') throw Error('Deployed contract code could not be verified. Try refreshing.');
    if (!same(token as Address, runtime.token.address)) throw Error('The escrow’s ARBT address does not match this deployment. Transactions are disabled.');
    return token as Address;
  }
  async function snapshot(account: Address, limit: number): Promise<Snapshot> {
    const tokenAddress = await verify();
    const block = await client.getBlock();
    const blockNumber = block.number;
    const token = { ...runtime.token, address: tokenAddress, blockNumber };
    const escrow = { ...runtime.escrow, blockNumber };
    const [balance, allowance, withdrawable, decimals, symbol, count] = await Promise.all([
      client.readContract({ ...token, functionName: 'balanceOf', args: [account] }),
      client.readContract({ ...token, functionName: 'allowance', args: [account, runtime.escrow.address] }),
      client.readContract({ ...escrow, functionName: 'withdrawable', args: [account] }),
      client.readContract({ ...token, functionName: 'decimals' }),
      client.readContract({ ...token, functionName: 'symbol' }),
      client.readContract({ ...escrow, functionName: 'escrowCount' }),
    ]) as [bigint, bigint, bigint, number, string, bigint];
    if (symbol !== 'ARBT' || decimals !== 18) throw Error('Unexpected token metadata. Transactions are disabled.');
    const scanned = Number(count > BigInt(limit) ? BigInt(limit) : count);
    const escrows: Escrow[] = [];
    // Bounded concurrency and explicit pagination, using contract views only.
    for (let offset = 0; offset < scanned; offset += 5) {
      const rows = await Promise.all(Array.from({ length: Math.min(5, scanned - offset) }, (_, i) => readEscrow(count - BigInt(offset + i), blockNumber)));
      escrows.push(...rows.filter(row => roleOf(row, account) !== 'observer'));
    }
    return { balance, allowance, withdrawable, decimals, symbol, count, escrows, scanned, block: blockNumber, timestamp: block.timestamp };
  }
  async function readEscrow(id: bigint, blockNumber?: bigint): Promise<Escrow> {
    const value = await client.readContract({ ...runtime.escrow, functionName: 'escrow', args: [id], blockNumber }) as Omit<Escrow, 'id'>;
    return { ...value, id };
  }
  async function assertWallet(account: Address, wallet: Provider) {
    const [chain, accounts] = await Promise.all([wallet.request({ method: 'eth_chainId' }), wallet.request({ method: 'eth_accounts' })]);
    if (Number(chain) !== runtime.chain.id || !accounts[0] || !same(accounts[0], account)) throw Error('Your wallet account or network changed. Refresh and review the action again.');
  }
  async function send(account: Address, wallet: Provider, target: 'token' | 'escrow', functionName: string, args: readonly unknown[]): Promise<Hash> {
    await assertWallet(account, wallet);
    await verify();
    const { request } = await client.simulateContract({ ...runtime[target], functionName, args, account });
    await assertWallet(account, wallet);
    return createWalletClient({ chain: runtime.chain, transport: custom(wallet) }).writeContract(request);
  }
  async function receipt(hash: Hash) {
    let replaced = false;
    const result = await client.waitForTransactionReceipt({
      hash, timeout: 120000,
      onReplaced: replacement => { if (replacement.reason !== 'repriced') replaced = true; },
    });
    if (replaced) throw Error('Transaction was cancelled or replaced in your wallet. Refresh to see the current escrow state.');
    if (result.status !== 'success') throw Error('Transaction reverted on-chain. Refresh the escrow before trying again.');
    return result;
  }
  return { verify, snapshot, readEscrow, send, receipt };
}
export async function switchNetwork(provider: Provider, runtime: Runtime) {
  const chainId = runtime.deployment.walletAddChain.chainId;
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  catch (error) {
    if (!unknownChain(error)) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [runtime.deployment.walletAddChain] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}
