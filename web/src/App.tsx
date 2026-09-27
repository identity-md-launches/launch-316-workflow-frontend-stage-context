import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { type Address, type Hash } from 'viem';
import type { Runtime } from './config';
import { gateway, switchNetwork, type Snapshot } from './gateway';
import { actionsFor, amountText, message, parseAmount, parseBps, partyError, roleOf, same, short, split, states, type Action, type Escrow } from './domain';
import { useWallet } from './useWallet';

type Review = { label: string; description: string; target: 'token' | 'escrow'; fn: string; args: readonly unknown[]; details: [string, string][] };
type Tx = { phase: 'signing' | 'pending' | 'confirmed' | 'failed'; label: string; hash?: Hash; error?: string };
const date = (time: bigint) => new Date(Number(time) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function Arrow() { return <span aria-hidden="true">↗</span>; }
function AddressLink({ address, runtime }: { address: Address; runtime: Runtime }) {
  return <a className="address" href={`${runtime.deployment.network.explorer}/address/${address}`} target="_blank" rel="noreferrer">{address} <Arrow /></a>;
}

export default function App({ runtime }: { runtime: Runtime }) {
  const wallet = useWallet();
  const { account, chainId, provider } = wallet;
  const rightChain = chainId === runtime.chain.id;
  const api = useMemo(() => gateway(runtime, rightChain ? provider : undefined), [runtime, provider, rightChain]);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [stored, setStored] = useState<{ account: Address; snapshot: Snapshot }>();
  const data = account && stored && same(account, stored.account) ? stored.snapshot : undefined;
  const [readError, setReadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(25);
  const [filter, setFilter] = useState('all');
  const [seller, setSeller] = useState('');
  const [arbiter, setArbiter] = useState('');
  const [amount, setAmount] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [tx, setTx] = useState<Tx>();
  const [switching, setSwitching] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [lookup, setLookup] = useState<Escrow>();
  const [lookupError, setLookupError] = useState('');
  const [looking, setLooking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const lookupRef = useRef<bigint | undefined>(undefined);
  const txLock = useRef(false);
  const busy = tx?.phase === 'signing' || tx?.phase === 'pending';
  const ready = !!account && rightChain && verified && !!data && !readError && !loading && !busy;
  const decimals = data?.decimals ?? 18;
  const units = (value: bigint) => `${amountText(value, decimals)} ARBT`;
  let paying = 0n;
  try { paying = parseAmount(amount, decimals); } catch { /* Form validation reports the exact error on submit. */ }
  const allowanceReady = !!data && paying > 0n && data.allowance >= paying;

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setReadError(''); setVerifyError(''); setLoading(true);
    try {
      if (account && rightChain) {
        const snapshot = await api.snapshot(account, limit);
        const selected = lookupRef.current;
        const updatedLookup = selected ? await api.readEscrow(selected, snapshot.block) : undefined;
        if (current !== generation.current) return;
        setStored({ account, snapshot });
        if (lookupRef.current === selected) setLookup(updatedLookup);
        setVerified(true);
      } else {
        await api.verify();
        if (current !== generation.current) return;
        setVerified(true);
      }
    } catch (error) {
      if (current !== generation.current) return;
      setVerified(false);
      if (account && rightChain) setReadError(message(error));
      else setVerifyError(message(error));
    } finally { if (current === generation.current) setLoading(false); }
  }, [account, api, limit, rightChain]);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  useEffect(() => {
    if (busy) return;
    const timer = window.setInterval(() => { void refresh(); }, 30000);
    return () => clearInterval(timer);
  }, [refresh, busy]);
  useEffect(() => { setReview(null); setLookup(undefined); lookupRef.current = undefined; setLookupError(''); setLimit(25); setAgreed(false); }, [account, chainId]);
  useEffect(() => {
    if (review) dialog.current?.showModal();
    else dialog.current?.close();
  }, [review]);

  async function switchChain() {
    if (!provider) return;
    setSwitching(true); wallet.setError('');
    try { await switchNetwork(provider, runtime); await wallet.sync(); }
    catch (error) { wallet.setError(message(error)); }
    finally { setSwitching(false); }
  }
  async function waitForReceipt(hash: Hash, label: string) {
    setTx({ phase: 'pending', label, hash });
    try {
      const receipt = await api.receipt(hash);
      setTx({ phase: 'confirmed', label, hash: receipt.transactionHash });
      await latestRefresh.current();
    } catch (error) {
      const reason = message(error);
      const terminal = /reverted on-chain|cancelled or replaced/.test(reason);
      setTx({ phase: terminal ? 'failed' : 'pending', label, hash, error: terminal ? reason : 'Submitted, but confirmation is unavailable. Check the explorer or check confirmation again. Do not resend.' });
      if (terminal) await latestRefresh.current();
    } finally { txLock.current = false; }
  }
  async function execute() {
    if (!review || !ready || !account || !provider || txLock.current) return;
    const request = review;
    setReview(null); txLock.current = true;
    setTx({ phase: 'signing', label: request.label });
    try {
      const hash = await api.send(account, provider, request.target, request.fn, request.args);
      await waitForReceipt(hash, request.label);
    } catch (error) { setTx({ phase: 'failed', label: request.label, error: message(error) }); txLock.current = false; }
  }
  function validateForm(): bigint | undefined {
    if (!account || !data) return;
    const errors: Record<string, string> = {};
    const sellerError = partyError(seller.trim(), account, arbiter.trim());
    const arbiterError = partyError(arbiter.trim(), account, seller.trim());
    if (sellerError) errors.seller = sellerError;
    if (arbiterError) errors.arbiter = arbiterError;
    let value: bigint | undefined;
    try { value = parseAmount(amount, data.decimals); if (value > data.balance) errors.amount = 'This amount exceeds your ARBT balance. Reduce it or acquire ARBT first.'; }
    catch (error) { errors.amount = message(error); }
    if (!agreed) errors.terms = 'Confirm that the parties and delivery terms are agreed.';
    setFormErrors(errors);
    if (Object.keys(errors).length) { document.getElementById(Object.keys(errors)[0])?.focus(); return; }
    return value;
  }
  function openReview(approve: boolean) {
    if (!ready) return;
    const value = validateForm();
    if (!value || !data) return;
    if (!approve && data.allowance < value) return;
    setReview(approve ? {
      label: 'Approve ARBT', description: 'Set the escrow contract’s spending allowance to exactly this amount. Approval does not open an escrow or move your ARBT.',
      target: 'token', fn: 'approve', args: [runtime.escrow.address, value], details: [['Allowance', units(value)], ['Spender', runtime.escrow.address]],
    } : {
      label: 'Open escrow', description: 'Move this ARBT amount into escrow. You are the buyer. The seller accepts your chosen arbiter and off-chain terms by marking delivery.',
      target: 'escrow', fn: 'open', args: [seller.trim(), arbiter.trim(), value], details: [['Deposit', units(value)], ['Buyer', account!], ['Seller', seller.trim()], ['Arbiter', arbiter.trim()]],
    });
  }
  function reviewAction(e: Escrow, action: Action, bps?: bigint) {
    if (!ready || !action.ready) return;
    const allocation = split(e.amount, bps ?? 5000n);
    setReview({ label: action.label, description: action.explanation, target: 'escrow', fn: action.name,
      args: action.name === 'resolve' ? [e.id, bps] : [e.id],
      details: [['Escrow', `#${e.id}`], ['Amount', units(e.amount)], ['Buyer', e.buyer], ['Seller', e.seller], ['Arbiter', e.arbiter],
        ...(action.name === 'resolve' ? [['Buyer credit', units(allocation.buyer)], ['Seller credit', units(allocation.seller)], ['Arbiter fee', units(allocation.fee)]] as [string, string][] : [])],
    });
  }
  async function findEscrow(event: FormEvent) {
    event.preventDefault(); setLookupError(''); setLookup(undefined); lookupRef.current = undefined;
    if (!/^\d+$/.test(lookupId) || BigInt(lookupId) < 1n || BigInt(lookupId) > 2n ** 256n - 1n) { setLookupError('Enter an escrow ID of 1 or greater.'); return; }
    const current = generation.current;
    setLooking(true);
    try { const row = await api.readEscrow(BigInt(lookupId), data?.block); if (current === generation.current) { setLookup(row); lookupRef.current = row.id; } }
    catch (error) { if (current === generation.current) setLookupError(`Could not load this escrow. Check the ID and try again. ${message(error)}`); }
    finally { setLooking(false); }
  }
  const rows = data?.escrows.filter(e => filter === 'all' || roleOf(e, account!) === filter) ?? [];
  const gate = !account ? 'Connect your wallet to read balances and open an escrow.' : !rightChain ? `Switch to ${runtime.chain.name} to continue.` : !verified ? 'Waiting for verified contract reads. Refresh if the connection fails.' : loading ? 'Refreshing balances and escrow state…' : readError ? 'Refresh the failed read before sending a transaction.' : busy ? 'Finish the current wallet transaction before starting another.' : '';

  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="header shell">
      <a className="brand" href="#main" aria-label="Arbiter home"><svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" /><path d="M10 29L20 9L30 29M15 22H25" /></svg><span>arbiter<span className="brand-dot">.</span></span></a>
      <div className="wallet-area"><span className="network"><span aria-hidden="true" />{runtime.chain.name} testnet</span>
        {wallet.choices.length > 1 && !account && <label className="wallet-select">Wallet<select value={wallet.selected} onChange={e => wallet.select(e.target.value)}>{wallet.choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        {account ? <><a className="account-link" href={`${runtime.deployment.network.explorer}/address/${account}`} target="_blank" rel="noreferrer" title={account}>{short(account)} <Arrow /></a><button className="small-button" onClick={wallet.disconnect}>Disconnect</button></> : <button onClick={() => void wallet.connect()} disabled={wallet.connecting}>{wallet.connecting ? 'Connecting…' : 'Connect wallet'} <span aria-hidden="true">↗</span></button>}
      </div>
    </header>
    <main id="main" className="shell">
      <section className="intro" aria-labelledby="page-title">
        <div><p className="eyebrow">An agreement between three parties</p><h1 id="page-title">Your agreement,<br /><em>held in escrow.</em></h1><p className="intro-copy">Fund an agreement in ARBT. Release payment when you’re ready, or let your chosen arbiter settle a dispute.</p></div>
        <div className="how-it-works" aria-label="How escrow works"><div><span className="step-no">01</span><span><strong>Fund the agreement</strong><small>The buyer deposits ARBT.</small></span></div><div><span className="step-no">02</span><span><strong>Confirm delivery</strong><small>The seller accepts the agreed terms.</small></span></div><div><span className="step-no">03</span><span><strong>Release or resolve</strong><small>Each recipient withdraws their credit.</small></span></div></div>
      </section>
      <div className="connection-notices">
        {wallet.error && <p role="alert" className="notice error">{wallet.error}</p>}
        {account && !rightChain && <div className="notice warning"><p>Your wallet is on another network. This escrow uses {runtime.chain.name}.</p><button disabled={switching} onClick={() => void switchChain()}>{switching ? 'Switching…' : `Switch to ${runtime.chain.name}`}</button></div>}
        {(verifyError || readError) && <div className="notice error" role="alert"><p>{verifyError || readError}</p><button onClick={() => void refresh()} disabled={loading || busy}>Retry reads</button></div>}
      </div>
      <section className="balances" aria-label="Your ARBT balances" aria-busy={loading}>
        <Balance label="Wallet balance" value={data ? units(data.balance) : '— ARBT'} hint="Available to fund an escrow" />
        <Balance label="Escrow allowance" value={data ? units(data.allowance) : '— ARBT'} hint="ARBT the escrow can spend" />
        <div className="withdraw-balance"><Balance label="Ready to withdraw" value={data ? units(data.withdrawable) : '— ARBT'} hint="Your settled escrow credits" /><button className="small-button" disabled={!ready || !data?.withdrawable} onClick={() => setReview({ label: 'Withdraw ARBT', description: 'Collect all your credited ARBT into the connected wallet. This does not withdraw funds from active escrows.', target: 'escrow', fn: 'withdraw', args: [], details: [['Amount', units(data!.withdrawable)], ['Recipient', account!]] })}>Withdraw <span aria-hidden="true">↗</span></button></div>
      </section>
      <div className="read-status"><span>{account && data ? `Read at block ${data.block.toLocaleString()} · ${date(data.timestamp)}` : 'Connect a wallet to load your live balances.'}</span><button className="text-button" onClick={() => void refresh()} disabled={loading || busy}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
      <div className="transaction-status" role="status" aria-live="polite">
        {tx && <div className={`notice ${tx.phase === 'failed' ? 'error' : ''}`}><div><strong>{tx.label}: {tx.phase === 'signing' ? 'simulating, then requesting your signature' : tx.phase === 'pending' ? 'waiting for confirmation' : tx.phase === 'confirmed' ? 'confirmed' : 'not completed'}.</strong>{tx.error && <p>{tx.error}</p>}{tx.hash && <a href={`${runtime.deployment.network.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View transaction <Arrow /></a>}</div>{tx.phase === 'pending' && tx.error && <button onClick={() => { if (!txLock.current) { txLock.current = true; void waitForReceipt(tx.hash!, tx.label); } }}>Check confirmation</button>}</div>}
      </div>
      <div className="workspace">
        <section className="open-panel panel" aria-labelledby="open-title">
          <div className="section-heading"><span className="section-index">01 / Create</span><h2 id="open-title">Open an escrow</h2><p>You’re the buyer. Choose a seller, agree on an arbiter, then fund the agreement.</p></div>
          <form noValidate onSubmit={e => { e.preventDefault(); openReview(!allowanceReady); }}>
            <Field id="seller" label="Seller address" hint="The wallet that will deliver the work." value={seller} onChange={setSeller} error={formErrors.seller} placeholder="0x…" />
            <Field id="arbiter" label="Arbiter address" hint="Choose someone both parties trust." value={arbiter} onChange={setArbiter} error={formErrors.arbiter} placeholder="0x…" />
            <Field id="amount" label="Escrow amount" hint="ARBT stays in the contract until settlement." value={amount} onChange={setAmount} error={formErrors.amount} placeholder="0.00" decimal suffix="ARBT" />
            <label className="terms"><input id="terms" type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} aria-invalid={!!formErrors.terms} aria-describedby={formErrors.terms ? 'terms-error' : undefined} /><span>I’ve agreed on the seller, arbiter and off-chain delivery terms.</span></label>
            {formErrors.terms && <p className="field-error" id="terms-error">{formErrors.terms}</p>}
            <div className="payment-steps"><button type="button" className={!allowanceReady ? 'primary' : ''} disabled={!ready || allowanceReady} onClick={() => openReview(true)}><span aria-hidden="true">{allowanceReady ? '✓' : '1'}</span>{allowanceReady ? 'Allowance ready' : 'Approve ARBT'}</button><button type="submit" className={allowanceReady ? 'primary' : ''} disabled={!ready || !allowanceReady}><span aria-hidden="true">2</span>Open escrow</button></div>
            <p className="small form-note">Approval sets an exact spending limit. Opening the escrow transfers ARBT. Both steps need a wallet confirmation and Sepolia ETH for gas.</p>
            {gate && <p className="gate">{gate}</p>}
          </form>
          <div className="token-note"><strong>Need ARBT?</strong><p>ARBT comes from swapping Sepolia ETH in this project’s launch pool. Acquire it before opening an escrow. This page does not perform swaps.</p></div>
        </section>
        <section className="escrows-panel" aria-labelledby="escrows-title">
          <div className="section-heading"><span className="section-index">02 / Manage</span><div className="heading-row"><h2 id="escrows-title">Your escrows</h2><label className="filter-label"><span className="sr-only">Filter by your role</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All roles</option><option value="buyer">As buyer</option><option value="seller">As seller</option><option value="arbiter">As arbiter</option></select></label></div><p>Agreements where you’re the buyer, seller or arbiter.</p></div>
          <div aria-busy={loading}>
            {!account ? <div className="empty panel"><span className="empty-mark" aria-hidden="true">↔</span><h3>Your agreements live here</h3><p>Connect your wallet to see your escrows, record delivery and settle payments.</p><button onClick={() => void wallet.connect()} disabled={wallet.connecting}>Connect wallet <span aria-hidden="true">↗</span></button></div> : !rightChain ? <div className="empty panel"><h3>Switch networks to view escrows</h3><p>Use the network control above to connect to {runtime.chain.name}.</p></div> : loading && !data ? <div className="empty panel" role="status"><h3>Reading your escrows…</h3><p>Loading ARBT balances and agreement state from the contract.</p></div> : !data ? <div className="empty panel"><h3>Escrow reads unavailable</h3><p>Retry the connection above. No transaction is enabled until the deployment is verified.</p></div> : <>
              {rows.length ? rows.map(e => <EscrowCard key={String(e.id)} escrow={e} account={account} now={data.timestamp} decimals={decimals} ready={ready} runtime={runtime} onAction={reviewAction} />) : <div className="empty panel"><span className="empty-mark" aria-hidden="true">↔</span><h3>{filter === 'all' ? 'No matching escrows in this range' : `No escrows as ${filter} in this range`}</h3><p>{data.count === 0n ? 'Open the first agreement using the form.' : 'Open an agreement, check another role or load older escrows below.'}</p>{filter !== 'all' && <button onClick={() => setFilter('all')}>Show all roles</button>}</div>}
              <div className="list-status"><p className="small">Checked {data.scanned} of {data.count.toString()} escrows, newest first. {rows.length} match this view.</p>{BigInt(data.scanned) < data.count && <button disabled={loading || busy} onClick={() => setLimit(n => n + 25)}>Load 25 older escrows</button>}</div>
            </>}
          </div>
          <details className="lookup panel"><summary>Find an escrow by ID</summary><p className="small">View any agreement. Anyone can settle a dispute after its 60-day timeout.</p><form onSubmit={e => void findEscrow(e)} className="lookup-form"><label htmlFor="lookup-id">Escrow ID<input id="lookup-id" inputMode="numeric" value={lookupId} onChange={e => setLookupId(e.target.value)} placeholder="1" aria-invalid={!!lookupError} aria-describedby={lookupError ? 'lookup-error' : undefined} /></label><button disabled={!ready || looking}>{looking ? 'Loading…' : 'Find escrow'}</button></form>{lookupError && <p id="lookup-error" className="field-error" role="alert">{lookupError}</p>}{lookup && account && data && <EscrowCard escrow={lookup} account={account} now={data.timestamp} decimals={decimals} ready={ready} runtime={runtime} onAction={reviewAction} />}</details>
        </section>
      </div>
      <section className="terms-section" aria-labelledby="terms-title"><h2 id="terms-title">Know the agreement</h2><div className="rules-grid"><div><span className="rule-number">14 days</span><h3>No delivery?</h3><p>The buyer can cancel while the escrow is still Funded, starting 14 days after opening.</p></div><div><span className="rule-number">30 days</span><h3>Delivery recorded?</h3><p>The seller can claim after 30 days if no dispute has been raised. The buyer can release earlier.</p></div><div><span className="rule-number">60 days</span><h3>Arbiter unavailable?</h3><p>After 60 days in Disputed, anyone can settle a 50/50 split without a fee. An odd minor unit goes to the buyer.</p></div></div><details><summary>Arbiter fees, acceptance and transaction races</summary><div className="terms-details"><p>The buyer chooses the arbiter, who may be controlled by the buyer. Agree on a trusted arbiter off-chain. The seller accepts all terms by marking delivery, or can refund while Funded or Delivered.</p><p>A resolution pays a floor-rounded 1% fee to the arbiter. The buyer’s chosen percentage applies to the remainder; the seller receives the rest. Each recipient calls Withdraw to collect.</p><p>The first confirmed transaction wins: delivery can prevent cancellation at day 14; a dispute can prevent the seller’s claim after day 30. Roles, state and chain time are checked again by the contract. A competing transaction may cause yours to revert.</p></div></details></section>
      <footer><div><span className="footer-brand">arbiter.</span><p>ARBT agreements · {runtime.chain.name} only</p></div><details className="deployment-details"><summary>Deployment & contract addresses</summary><p className="small">{verified ? 'ABI hashes, contract code and token binding checked.' : 'Deployment verification pending.'}</p><dl>{runtime.deployment.contracts.map(c => <div key={c.name}><dt>{c.name}</dt><dd><AddressLink address={c.address} runtime={runtime} /></dd></div>)}<div><dt>Connected wallet</dt><dd>{account ?? 'Not connected'}</dd></div></dl><a href="./imd-deployment.json">View deployment manifest <Arrow /></a></details></footer>
    </main>
    <dialog ref={dialog} onCancel={() => setReview(null)} onClose={() => setReview(null)} aria-labelledby="review-title" aria-describedby="review-description">
      {review && <><p className="eyebrow">Review · {runtime.chain.name}</p><h2 id="review-title">{review.label}</h2><p id="review-description">{review.description}</p><dl className="review-details">{review.details.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p className="small">The transaction will be simulated before your wallet asks you to sign. Gas is paid in Sepolia ETH.</p><div className="dialog-actions"><button autoFocus onClick={() => setReview(null)}>Go back</button><button className="primary" disabled={!ready} onClick={() => void execute()}>Confirm {review.label.toLowerCase()}</button></div></>}
    </dialog>
  </>;
}
function Balance({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="balance"><h2>{label}</h2><p className="balance-value">{value}</p><p className="small">{hint}</p></div>; }
function Field({ id, label, hint, value, onChange, error, placeholder, decimal, suffix }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void; error?: string; placeholder: string; decimal?: boolean; suffix?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label><div className="input-wrap"><input id={id} name={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} inputMode={decimal ? 'decimal' : 'text'} autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />{suffix && <span className="input-suffix">{suffix}</span>}</div><p className="field-hint" id={`${id}-hint`}>{hint}</p>{error && <p className="field-error" id={`${id}-error`}>{error}</p>}</div>;
}
function EscrowCard({ escrow: e, account, now, decimals, ready, runtime, onAction }: { escrow: Escrow; account: Address; now: bigint; decimals: number; ready: boolean; runtime: Runtime; onAction: (e: Escrow, a: Action, bps?: bigint) => void }) {
  const [share, setShare] = useState('50');
  const controlId = useId();
  let bps: bigint | undefined;
  let splitError = '';
  try { bps = parseBps(share); } catch (error) { splitError = message(error); }
  const role = roleOf(e, account);
  const actions = actionsFor(e, account, now);
  const allocation = bps !== undefined ? split(e.amount, bps) : undefined;
  return <article className="escrow-card panel"><div className="card-heading"><h3>Escrow #{e.id.toString()}</h3><span className={`state state-${e.state}`}>{states[e.state] ?? 'Unknown state'}</span></div><p className="escrow-amount">{amountText(e.amount, decimals)} <span>ARBT</span></p><p className="small role-label">{role === 'observer' ? 'You are viewing this agreement' : `You are the ${role}`} · Opened {date(e.openedAt)}</p><details className="parties"><summary>View parties & timestamps</summary><dl>{(['buyer', 'seller', 'arbiter'] as const).map(party => <div key={party}><dt>{party}</dt><dd><AddressLink address={e[party]} runtime={runtime} /></dd></div>)}{e.deliveredAt > 0n && <div><dt>Delivered</dt><dd>{date(e.deliveredAt)}</dd></div>}{e.disputedAt > 0n && <div><dt>Disputed</dt><dd>{date(e.disputedAt)}</dd></div>}</dl></details>
    {e.state === 2 && role === 'arbiter' && <div className="resolution"><label htmlFor={`share-${controlId}`}>Buyer share after 1% fee (%)</label><input id={`share-${controlId}`} inputMode="decimal" value={share} onChange={event => setShare(event.target.value)} aria-invalid={!!splitError} aria-describedby={`split-${controlId}`} /><p id={`split-${controlId}`} className={splitError ? 'field-error' : 'small'}>{splitError || `Buyer: ${amountText(allocation!.buyer, decimals)} ARBT · Seller: ${amountText(allocation!.seller, decimals)} ARBT · Arbiter: ${amountText(allocation!.fee, decimals)} ARBT`}</p></div>}
    <div className="escrow-actions">{actions.map(action => <div key={action.name}><button disabled={!ready || !action.ready || (action.name === 'resolve' && bps === undefined)} onClick={() => onAction(e, action, bps)}>{action.label}</button>{!action.ready && action.availableAt && <p className="small">Available {date(action.availableAt)}</p>}</div>)}</div>
    {e.state === 3 && <p className="closed-note">Settled. Any credit owed to you is included in “Ready to withdraw.”</p>}{actions.length === 0 && e.state !== 3 && <p className="small">No action is available for your role in this state.</p>}
  </article>;
}
