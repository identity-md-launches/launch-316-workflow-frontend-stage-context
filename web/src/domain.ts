import { formatUnits, isAddress, parseUnits, zeroAddress, type Address } from 'viem';
export type Escrow = {
  id: bigint; buyer: Address; seller: Address; arbiter: Address; amount: bigint;
  openedAt: bigint; deliveredAt: bigint; disputedAt: bigint; state: number;
};
export const states = ['Funded', 'Delivered', 'Disputed', 'Closed'];
export const day = 86400n;
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const amountText = (amount: bigint, decimals: number) => formatUnits(amount, decimals);
export function roleOf(escrow: Escrow, account: Address): 'buyer' | 'seller' | 'arbiter' | 'observer' {
  return same(escrow.buyer, account) ? 'buyer' : same(escrow.seller, account) ? 'seller' : same(escrow.arbiter, account) ? 'arbiter' : 'observer';
}
export type ActionName = 'markDelivered' | 'release' | 'refund' | 'cancel' | 'dispute' | 'resolve' | 'claimAfterDelivery' | 'timeout';
export type Action = { name: ActionName; label: string; explanation: string; ready: boolean; availableAt?: bigint };
export function actionsFor(e: Escrow, account: Address, now: bigint): Action[] {
  const role = roleOf(e, account);
  const actions: Action[] = [];
  function add(name: ActionName, label: string, explanation: string, availableAt?: bigint) {
    actions.push({ name, label, explanation, availableAt, ready: availableAt === undefined || now >= availableAt });
  }
  if (e.state === 0 && role === 'seller') add('markDelivered', 'Mark delivered', 'Accept the buyer’s chosen arbiter and terms, and record delivery. Delivery itself is agreed off-chain.');
  if (e.state < 2 && role === 'buyer') add('release', 'Release to seller', 'Close this escrow and credit its full ARBT amount to the seller. The seller then withdraws it.');
  if (e.state < 2 && role === 'seller') add('refund', 'Refund buyer', 'Close this escrow and credit its full ARBT amount to the buyer. The buyer then withdraws it.');
  if (e.state === 0 && role === 'buyer') add('cancel', 'Cancel escrow', 'Close this undelivered escrow and credit its full amount to you. Delivery can win the race before your transaction confirms.', e.openedAt + 14n * day);
  if (e.state === 1 && (role === 'buyer' || role === 'seller')) add('dispute', 'Raise dispute', 'Ask the chosen arbiter to split this escrow. A resolution charges a 1% arbiter fee. After 60 days, anyone can trigger an equal split without a fee.');
  if (e.state === 1 && role === 'seller') add('claimAfterDelivery', 'Claim after delivery', 'Close this escrow and credit its full amount to you. A dispute can win the race before your transaction confirms.', e.deliveredAt + 30n * day);
  if (e.state === 2 && role === 'arbiter') add('resolve', 'Resolve dispute', 'Close this escrow with the split shown below. You receive the floor-rounded 1% fee. Each party withdraws their own credit.');
  if (e.state === 2) add('timeout', 'Settle timed-out dispute', 'Close this escrow: half goes to each party, with any odd minor unit going to the buyer. There is no arbiter fee.', e.disputedAt + 60n * day);
  return actions;
}
export function parseAmount(value: string, decimals: number): bigint {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > decimals) throw Error(`Enter a positive ARBT amount with up to ${decimals} decimal places.`);
  const amount = parseUnits(text, decimals);
  if (amount <= 0n || amount > 2n ** 256n - 1n) throw Error('Enter an ARBT amount greater than zero and within the token limit.');
  return amount;
}
export function partyError(value: string, buyer: Address, other: string) {
  if (!isAddress(value) || same(value, zeroAddress)) return 'Enter a complete, non-zero wallet address.';
  if (same(value, buyer) || same(value, other)) return 'Buyer, seller and arbiter must be three different addresses.';
  return '';
}
export function split(amount: bigint, bps: bigint) {
  const fee = amount / 100n;
  const buyer = (amount - fee) * bps / 10000n;
  return { buyer, seller: amount - fee - buyer, fee };
}
export function parseBps(text: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('Enter a buyer share from 0 to 100%, with up to two decimal places.');
  const bps = parseUnits(text, 2);
  if (bps > 10000n) throw Error('Enter a buyer share from 0 to 100%.');
  return bps;
}
export function message(error: unknown): string {
  const err = error as { code?: number; shortMessage?: string; message?: string; cause?: unknown };
  if (err?.code === 4001 || /rejected|denied/i.test(err?.shortMessage ?? err?.message ?? '')) return 'Request declined in your wallet. You can try again when ready.';
  return err?.shortMessage ?? err?.message ?? 'The request failed. Check your connection and try again.';
}
export function unknownChain(error: unknown): boolean {
  const err = error as { code?: number; message?: string; cause?: unknown; data?: { originalError?: unknown } };
  return err?.code === 4902 || /unknown chain|unrecognized chain|not added|not configured/i.test(err?.message ?? '')
    || (!!err?.cause && unknownChain(err.cause)) || (!!err?.data?.originalError && unknownChain(err.data.originalError));
}
