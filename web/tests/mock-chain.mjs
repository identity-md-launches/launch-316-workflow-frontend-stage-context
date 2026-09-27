import { readFile } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionResult, encodeErrorResult, toHex } from 'viem';
export const BUYER = '0x1111111111111111111111111111111111111111';
export const SELLER = '0x2222222222222222222222222222222222222222';
export const ARBITER = '0x3333333333333333333333333333333333333333';
export const OUTSIDER = '0x4444444444444444444444444444444444444444';
export const UNIT = 10n ** 18n;
export const NOW = 2000000000n;
const config = JSON.parse(await readFile(new URL('../../dist/imd-deployment.json', import.meta.url), 'utf8'));
const abi = {};
for (const c of config.contracts) abi[c.name] = JSON.parse(await readFile(new URL(`../../dist/${c.abiPath}`, import.meta.url), 'utf8'));
export const deployment = config;
const token = config.contracts.find(c => c.name === 'LaunchToken').address;
const escrow = config.contracts.find(c => c.name === 'ArbiterEscrow').address;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const blockHash = hash(999);
export function row(state = 0, options = {}) {
  return { buyer: BUYER, seller: SELLER, arbiter: ARBITER, amount: 100n * UNIT, openedAt: NOW - 14n * 86400n, deliveredAt: state >= 1 ? NOW - 30n * 86400n : 0n, disputedAt: state >= 2 ? NOW - 60n * 86400n : 0n, state, ...options };
}
export function model(options = {}) {
  return { account: BUYER, chain: toHex(config.chainId), knownChain: true, escrows: [], balance: new Map([[BUYER, 1000n * UNIT], [SELLER, 0n], [ARBITER, 0n]]), allowance: new Map(), credit: new Map(), sent: [], requests: [], receipts: new Map(), now: NOW, emptyCode: false, wrongRpcChain: false, readFailure: false, simulateFailure: false, reject: false, revertReceipt: false, delay: 0, ...options };
}
function contractCall(state, params, mutate = false) {
  const call = params[0];
  if (![token, escrow].some(address => address.toLowerCase() === call.to.toLowerCase())) throw Error('Unexpected contract address');
  const isToken = call.to.toLowerCase() === token.toLowerCase();
  const contractAbi = isToken ? abi.LaunchToken : abi.ArbiterEscrow;
  const { functionName: fn, args = [] } = decodeFunctionData({ abi: contractAbi, data: call.data });
  const sender = (call.from ?? state.account).toLowerCase();
  const get = (map, who = sender) => map.get(who.toLowerCase()) ?? 0n;
  const fail = name => { throw { code: 3, message: `execution reverted: ${name}`, data: encodeErrorResult({ abi: abi.ArbiterEscrow, errorName: name }) }; };
  let result;
  if (fn === 'token') result = token;
  else if (fn === 'decimals') result = 18;
  else if (fn === 'symbol') result = 'ARBT';
  else if (fn === 'balanceOf') result = get(state.balance, args[0]);
  else if (fn === 'allowance') result = get(state.allowance, args[0]);
  else if (fn === 'withdrawable') result = get(state.credit, args[0]);
  else if (fn === 'escrowCount') result = BigInt(state.escrows.length);
  else if (fn === 'escrow') { result = state.escrows[Number(args[0]) - 1]; if (!result) throw { code: 3, message: 'UnknownEscrow' }; }
  else {
    if (state.simulateFailure && !mutate) fail('InvalidState');
    if (fn === 'approve') {
      if (args[0].toLowerCase() !== escrow.toLowerCase()) throw Error('Unexpected approval spender');
      result = true; if (mutate) state.allowance.set(sender, args[1]);
    } else if (fn === 'open') {
      if (get(state.allowance) < args[2] || get(state.balance) < args[2]) fail('InvalidAmount');
      result = BigInt(state.escrows.length + 1);
      if (mutate) {
        state.balance.set(sender, get(state.balance) - args[2]); state.allowance.set(sender, get(state.allowance) - args[2]);
        state.escrows.push(row(0, { buyer: sender, seller: args[0], arbiter: args[1], amount: args[2], openedAt: state.now }));
      }
    } else if (fn === 'withdraw') {
      if (get(state.credit) === 0n) fail('NothingToWithdraw');
      if (mutate) { state.balance.set(sender, get(state.balance) + get(state.credit)); state.credit.set(sender, 0n); }
    } else {
      const e = state.escrows[Number(args[0]) - 1];
      if (!e) throw { code: 3, message: 'UnknownEscrow' };
      const is = who => sender === e[who].toLowerCase();
      if (['release','cancel'].includes(fn) && !is('buyer')) fail('Unauthorized');
      if (['markDelivered','refund','claimAfterDelivery'].includes(fn) && !is('seller')) fail('Unauthorized');
      if (fn === 'dispute' && !is('buyer') && !is('seller')) fail('Unauthorized');
      if (fn === 'resolve' && !is('arbiter')) fail('Unauthorized');
      if (['markDelivered','cancel'].includes(fn) && e.state !== 0) fail('InvalidState');
      if (['refund','release'].includes(fn) && e.state > 1) fail('InvalidState');
      if (['dispute','claimAfterDelivery'].includes(fn) && e.state !== 1) fail('InvalidState');
      if (['resolve','timeout'].includes(fn) && e.state !== 2) fail('InvalidState');
      if (fn === 'cancel' && state.now < e.openedAt + 14n * 86400n) fail('InvalidState');
      if (fn === 'claimAfterDelivery' && state.now < e.deliveredAt + 30n * 86400n) fail('InvalidState');
      if (fn === 'timeout' && state.now < e.disputedAt + 60n * 86400n) fail('InvalidState');
      if (mutate) {
        const credit = (who, amount) => state.credit.set(e[who].toLowerCase(), get(state.credit, e[who]) + amount);
        if (fn === 'markDelivered') { e.state = 1; e.deliveredAt = state.now; }
        else if (fn === 'dispute') { e.state = 2; e.disputedAt = state.now; }
        else {
          e.state = 3;
          if (['release','claimAfterDelivery'].includes(fn)) credit('seller', e.amount);
          else if (['refund','cancel'].includes(fn)) credit('buyer', e.amount);
          else if (fn === 'timeout') { credit('buyer', e.amount - e.amount / 2n); credit('seller', e.amount / 2n); }
          else if (fn === 'resolve') { const fee = e.amount / 100n; const buyer = (e.amount - fee) * args[1] / 10000n; credit('buyer', buyer); credit('seller', e.amount - fee - buyer); credit('arbiter', fee); }
        }
      }
    }
  }
  if (mutate) return fn;
  return encodeFunctionResult({ abi: contractAbi, functionName: fn, result });
}
function block(state) {
  return { number: '0x64', hash: blockHash, parentHash: hash(998), nonce: '0x0000000000000000', sha3Uncles: hash(0), logsBloom: `0x${'0'.repeat(512)}`, transactionsRoot: hash(0), stateRoot: hash(0), receiptsRoot: hash(0), miner: OUTSIDER, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x5208', timestamp: toHex(state.now), transactions: [], uncles: [], baseFeePerGas: '0x1' };
}
export function rpc(state, method, params = []) {
  if (state.readFailure) throw { code: -32000, message: 'Mock RPC temporarily unavailable' };
  if (method === 'eth_chainId') return state.wrongRpcChain ? '0x1' : toHex(config.chainId);
  if (method === 'eth_getCode') return state.emptyCode ? '0x' : '0x60006000';
  if (method === 'eth_call') return contractCall(state, params);
  if (method === 'eth_getBlockByNumber') return block(state);
  if (method === 'eth_blockNumber') return '0x64';
  if (method === 'eth_getTransactionReceipt') return state.receipts.get(params[0]) ?? null;
  if (method === 'eth_getTransactionByHash') return { hash: params[0], blockHash, blockNumber: '0x64', from: state.account, to: escrow, input: '0x', nonce: '0x0', value: '0x0', gas: '0x5208', gasPrice: '0x1', transactionIndex: '0x0', type: '0x0', v: '0x1b', r: hash(1), s: hash(1) };
  throw Error(`Unhandled RPC method ${method}`);
}
export async function setup(page, state, wallet = true) {
  const faults = { console: [], resources: [], external: [] };
  page.on('pageerror', error => faults.console.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') faults.console.push(msg.text()); });
  page.on('requestfailed', req => faults.resources.push(req.url()));
  await page.route('**/*', async route => {
    const req = route.request();
    if (config.network.rpcUrls.some(url => req.url().startsWith(url))) {
      const respond = async payload => {
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
        try { return { jsonrpc: '2.0', id: payload.id, result: rpc(state, payload.method, payload.params) }; }
        catch (error) { return { jsonrpc: '2.0', id: payload.id, error: { code: error.code ?? -32000, message: error.message, data: error.data } }; }
      };
      const body = req.postDataJSON();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? await Promise.all(body.map(respond)) : await respond(body)) });
    }
    if (new URL(req.url()).hostname !== '127.0.0.1') { faults.external.push(req.url()); return route.abort(); }
    return route.continue();
  });
  if (wallet) {
    await page.exposeBinding('walletRequest', async (_source, request) => {
      const { method, params = [] } = request;
      state.requests.push(request);
      if (state.reject && ['eth_requestAccounts', 'eth_sendTransaction'].includes(method)) return { error: { code: 4001, message: 'User rejected the request' } };
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return { result: state.account ? [state.account] : [] };
      if (method === 'eth_chainId') return { result: state.chain };
      if (method === 'wallet_switchEthereumChain') {
        if (!state.knownChain) return { error: { code: 4902, message: 'Unknown chain' } };
        state.chain = params[0].chainId;
        return { result: null };
      }
      if (method === 'wallet_addEthereumChain') { state.knownChain = true; return { result: null }; }
      if (method === 'eth_sendTransaction') {
        const txHash = hash(state.sent.length + 1);
        const fn = state.revertReceipt ? decodeFunctionData({ abi: abi.ArbiterEscrow, data: params[0].data }).functionName : contractCall(state, params, true);
        state.sent.push({ ...params[0], functionName: fn, hash: txHash });
        state.receipts.set(txHash, { transactionHash: txHash, blockHash, blockNumber: '0x64', transactionIndex: '0x0', from: state.account, to: params[0].to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: state.revertReceipt ? '0x0' : '0x1', effectiveGasPrice: '0x1', type: '0x0' });
        return { result: txHash };
      }
      try { return { result: rpc(state, method, params) }; }
      catch (error) { return { error: { code: error.code ?? -32000, message: error.message, data: error.data } }; }
    });
    await page.addInitScript(() => {
      const handlers = {};
      window.ethereum = {
        request: async args => { const answer = await window.walletRequest(args); if (answer.error) throw Object.assign(new Error(answer.error.message), answer.error); return answer.result; },
        on: (name, callback) => { (handlers[name] ??= []).push(callback); },
        removeListener: (name, callback) => { handlers[name] = handlers[name]?.filter(fn => fn !== callback); },
      };
      window.emitWallet = (name, value) => handlers[name]?.forEach(fn => fn(value));
    });
  }
  return faults;
}
export async function changeAccount(page, state, account) {
  state.account = account;
  await page.evaluate(account => window.emitWallet('accountsChanged', account ? [account] : []), account);
}
