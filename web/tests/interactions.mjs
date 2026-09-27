import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { model, row, setup, changeAccount, BUYER, SELLER, ARBITER, OUTSIDER, UNIT, NOW, deployment } from './mock-chain.mjs';
import { actionsFor, parseAmount, parseBps, split } from '../src/domain.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'docs/frontend');
await mkdir(output, { recursive: true });
const results = [];
const screenshots = [];
const report = { checkedAt: new Date().toISOString(), browser: '', source: 'Production dist, served below /preview/', liveTransactions: 0, results, screenshots, observations: [] };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/preview/')) { res.writeHead(404); res.end(); return; }
    const path = resolve(root, 'dist', pathname.slice(9) || 'index.html');
    if (!path.startsWith(resolve(root, 'dist') + sep)) throw Error('Invalid path');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[extname(path)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/tmp/arbiter-playwright-browsers';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
report.browser = browser.version();
async function test(name, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  try { await run(page); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); await page.screenshot({ path: resolve(root, 'test/scratch/frontend-failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { await context.close(); }
}
async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await page.getByText(/Read at block/).waitFor();
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
}
async function confirm(page, label) {
  await page.getByRole('button', { name: `Confirm ${label.toLowerCase()}`, exact: true }).click();
  await page.getByText(`${label}: confirmed.`, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
}
async function action(page, label, index = 0) {
  await page.getByRole('button', { name: label, exact: true }).nth(index).click();
  await confirm(page, label);
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(output, name), fullPage: true, type: 'jpeg', quality: 82 });
  screenshots.push(name);
}
async function overflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(size.scroll <= size.width, JSON.stringify(size));
}
async function axe(page) {
  await page.addScriptTag({ path: resolve(root, 'web/node_modules/axe-core/axe.min.js') });
  const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
  assert.deepEqual(result, []);
}
try {
  // Independent expectations for the exact contract state/role/time matrix.
  const expected = {
    0: { [BUYER]: ['release','cancel'], [SELLER]: ['markDelivered','refund'], [ARBITER]: [], [OUTSIDER]: [] },
    1: { [BUYER]: ['release','dispute'], [SELLER]: ['refund','dispute','claimAfterDelivery'], [ARBITER]: [], [OUTSIDER]: [] },
    2: { [BUYER]: ['timeout'], [SELLER]: ['timeout'], [ARBITER]: ['resolve','timeout'], [OUTSIDER]: ['timeout'] },
    3: { [BUYER]: [], [SELLER]: [], [ARBITER]: [], [OUTSIDER]: [] },
  };
  for (const state of [0,1,2,3]) for (const account of [BUYER,SELLER,ARBITER,OUTSIDER]) assert.deepEqual(actionsFor({ ...row(state), id: 1n }, account, NOW).map(a => a.name), expected[state][account]);
  for (const [state, account, fn, time] of [[0,BUYER,'cancel','openedAt'], [1,SELLER,'claimAfterDelivery','deliveredAt'], [2,OUTSIDER,'timeout','disputedAt']]) {
    const e = { ...row(state), id: 1n }; assert(e[time] > 0n);
    assert.equal(actionsFor(e, account, NOW - 1n).find(a => a.name === fn).ready, false);
    assert.equal(actionsFor(e, account, NOW).find(a => a.name === fn).ready, true);
    assert.equal(actionsFor(e, account, NOW + 1n).find(a => a.name === fn).ready, true);
  }
  assert.equal(parseAmount('0.000000000000000001', 18), 1n);
  for (const invalid of ['0','-1','1e18','NaN','1.0000000000000000001','1.2.3']) assert.throws(() => parseAmount(invalid, 18));
  assert.equal(parseBps('99.99'), 9999n); assert.throws(() => parseBps('100.01')); assert.throws(() => parseBps('-1'));
  for (let i = 1n; i <= 1000n; i++) { const amount = i ** 9n + 17n; const result = split(amount, i * 10n); assert.equal(result.buyer + result.seller + result.fee, amount); assert.equal(result.fee, amount / 100n); }
  results.push({ name: '16 role/state combinations; exact 14/30/60-day boundaries ±1 second; amount precision; 1,000 split-conservation cases', passed: true });

  await test('Disconnected, missing-wallet recovery, static subpath resources, desktop/mobile reflow and accessibility', async page => {
    const faults = await setup(page, model(), false);
    await page.goto(url); await page.getByRole('heading', { name: 'Open an escrow' }).waitFor();
    assert(await page.getByRole('button', { name: 'Approve ARBT', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Connect wallet' }).first().click();
    await page.getByRole('alert').filter({ hasText: 'No browser wallet found' }).waitFor();
    await page.keyboard.press('Tab');
    await shot(page, 'desktop-disconnected.jpg');
    await axe(page);
    for (const width of [320,390,740,1024,1440]) { await page.setViewportSize({ width, height: 1000 }); await overflow(page); }
    await page.setViewportSize({ width: 320, height: 850 }); await shot(page, 'mobile-320-disconnected.jpg');
    assert.deepEqual(faults, { console: [], resources: [], external: [] });
  });
  await test('Unknown-chain switch → add exact handoff network → switch again', async page => {
    const state = model({ chain: '0x1', knownChain: false }); await setup(page, state); await page.goto(url);
    await page.getByRole('button', { name: 'Connect wallet' }).first().click();
    assert(await page.getByRole('button', { name: 'Approve ARBT', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
    await page.getByText(/Read at block/).waitFor();
    const calls = state.requests.filter(r => r.method.startsWith('wallet_'));
    assert.deepEqual(calls.map(c => c.method), ['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain']);
    assert.deepEqual(calls[1].params[0], deployment.walletAddChain);
  });
  await test('Keyboard approval, input validation, open, buyer release, seller withdrawal and receipt refresh', async page => {
    const state = model(); const faults = await setup(page, state); await page.goto(url); await connect(page);
    await page.getByRole('button', { name: 'Approve ARBT', exact: true }).click();
    assert.equal(await page.locator(':focus').getAttribute('id'), 'seller');
    assert.equal(state.sent.length, 0);
    await page.getByLabel('Seller address', { exact: true }).fill(SELLER);
    await page.getByLabel('Arbiter address', { exact: true }).fill(ARBITER);
    await page.getByLabel('Escrow amount', { exact: true }).fill('100.000000000000000001');
    await page.getByLabel(/I’ve agreed/).check();
    await page.getByRole('button', { name: 'Approve ARBT', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator(':focus').textContent(), 'Go back');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(':focus').textContent(), '1Approve ARBT');
    await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    await page.getByText('Approve ARBT: confirmed.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
    await page.getByRole('dialog').getByText('100.000000000000000001 ARBT', { exact: true }).waitFor();
    await confirm(page, 'Open escrow');
    await page.getByRole('heading', { name: 'Escrow #1', exact: true }).waitFor();
    assert.equal(state.sent[0].functionName, 'approve'); assert.equal(state.sent[1].functionName, 'open');
    assert.equal(state.escrows[0].amount, 100n * UNIT + 1n);
    assert(await page.getByRole('button', { name: 'Cancel escrow', exact: true }).isDisabled());
    await shot(page, 'desktop-funded-mock.jpg');
    await page.getByRole('button', { name: 'Release to seller', exact: true }).click();
    await page.getByRole('button', { name: 'Go back' }).click(); assert.equal(state.sent.length, 2);
    await action(page, 'Release to seller'); assert.equal(state.escrows[0].state, 3);
    await changeAccount(page, state, SELLER); await page.getByText('You are the seller', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click(); await confirm(page, 'Withdraw ARBT');
    assert.equal(state.credit.get(SELLER), 0n); assert.equal(state.balance.get(SELLER), 100n * UNIT + 1n);
    assert(await page.getByRole('button', { name: 'Withdraw', exact: true }).isDisabled());
    assert.deepEqual(faults, { console: [], resources: [], external: [] });
  });
  await test('Seller marks delivery, refunds, and claims at the exact 30-day boundary', async page => {
    const state = model({ account: SELLER, escrows: [row(0),row(0),row(1)] }); await setup(page, state); await page.goto(url); await connect(page);
    await action(page, 'Mark delivered'); assert.equal(state.escrows[1].state, 1);
    await action(page, 'Refund buyer'); assert.equal(state.escrows[2].state, 3);
    // Remaining delivered escrow is new, so its claim is disabled; oldest Funded can still be refunded.
    assert(await page.getByRole('button', { name: 'Claim after delivery', exact: true }).isDisabled());
    state.escrows[1].deliveredAt = NOW - 30n * 86400n;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await action(page, 'Claim after delivery'); assert.equal(state.escrows[1].state, 3);
    await axe(page);
  });
  await test('Buyer disputes delivery and cancels at the exact 14-day boundary', async page => {
    const state = model({ escrows: [row(0),row(1)] }); await setup(page, state); await page.goto(url); await connect(page);
    await action(page, 'Raise dispute'); assert.equal(state.escrows[1].state, 2);
    await action(page, 'Cancel escrow'); assert.equal(state.escrows[0].state, 3);
  });
  await test('Arbiter split preview, validation, resolve, mobile cards and dialog accessibility', async page => {
    const state = model({ account: ARBITER, escrows: [row(2)] }); await setup(page, state); await page.goto(url); await connect(page);
    await page.getByLabel('Buyer share after 1% fee (%)').fill('101');
    assert(await page.getByRole('button', { name: 'Resolve dispute', exact: true }).isDisabled());
    await page.getByLabel('Buyer share after 1% fee (%)').fill('25.5');
    await page.getByText(/Buyer: 25.245 ARBT/).waitFor();
    await page.getByText('View parties & timestamps').click();
    await page.setViewportSize({ width: 390, height: 850 }); await overflow(page); await axe(page);
    await shot(page, 'mobile-dispute-mock.jpg');
    await page.getByRole('button', { name: 'Resolve dispute', exact: true }).click();
    await axe(page); await shot(page, 'mobile-review-mock.jpg');
    await confirm(page, 'Resolve dispute');
    assert.equal(state.credit.get(BUYER), 25245n * UNIT / 1000n); assert.equal(state.credit.get(ARBITER), UNIT);
  });
  await test('Lookup refresh updates state, and duplicate cards have distinct accessible fields', async page => {
    const state = model({ account: ARBITER, escrows: [row(2)] }); await setup(page, state); await page.goto(url); await connect(page);
    await page.getByText('Find an escrow by ID', { exact: true }).click();
    await page.getByLabel('Escrow ID', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Find escrow', exact: true }).click();
    await page.getByLabel('Buyer share after 1% fee (%)').nth(1).waitFor();
    const ids = await page.getByLabel('Buyer share after 1% fee (%)').evaluateAll(elements => elements.map(el => el.id));
    assert.equal(new Set(ids).size, 2); await axe(page);
    state.escrows[0].state = 3;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Resolve dispute', exact: true }).count(), 0);
    assert.equal(await page.getByText('Closed', { exact: true }).count(), 2);
  });
  await test('Observer lookup and permissionless timeout at exact 60-day boundary', async page => {
    const state = model({ account: OUTSIDER, escrows: [row(2, { amount: 101n })] }); await setup(page, state); await page.goto(url); await connect(page);
    await page.getByText('Find an escrow by ID', { exact: true }).click();
    await page.getByLabel('Escrow ID', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Find escrow', exact: true }).click();
    await action(page, 'Settle timed-out dispute'); assert.equal(state.credit.get(BUYER), 51n); assert.equal(state.credit.get(SELLER), 50n);
  });
  await test('Simulation revert blocks signing, wallet rejection is recoverable, on-chain revert is visible', async page => {
    const state = model({ escrows: [row(0)] }); await setup(page, state); await page.goto(url); await connect(page);
    state.simulateFailure = true; await page.getByRole('button', { name: 'Release to seller', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm release to seller', exact: true }).click();
    await page.getByText('Release to seller: not completed.', { exact: true }).waitFor(); assert.equal(state.sent.length, 0);
    state.simulateFailure = false; state.reject = true;
    await page.getByRole('button', { name: 'Release to seller', exact: true }).click(); await page.getByRole('button', { name: 'Confirm release to seller', exact: true }).click();
    await page.getByText('Request declined in your wallet. You can try again when ready.', { exact: true }).waitFor(); assert.equal(state.sent.length, 0);
    state.reject = false; state.revertReceipt = true;
    await page.getByRole('button', { name: 'Release to seller', exact: true }).click(); await page.getByRole('button', { name: 'Confirm release to seller', exact: true }).click();
    await page.getByText('Transaction reverted on-chain. Refresh the escrow before trying again.', { exact: true }).waitFor();
    assert.equal(state.escrows[0].state, 0);
  });
  await test('Wallet account/network changes cancel review and gate transactions', async page => {
    const state = model({ escrows: [row(0)] }); await setup(page, state); await page.goto(url); await connect(page);
    await page.getByRole('button', { name: 'Release to seller', exact: true }).click();
    await changeAccount(page, state, SELLER); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Mark delivered', exact: true }).waitFor();
    state.chain = '0x1'; await page.evaluate(() => window.emitWallet('chainChanged', '0x1'));
    await page.getByRole('button', { name: 'Switch to Sepolia' }).waitFor();
    assert(await page.getByRole('button', { name: 'Approve ARBT', exact: true }).isDisabled());
    await changeAccount(page, state, undefined); await page.getByRole('button', { name: 'Connect wallet' }).first().waitFor(); assert.equal(state.sent.length, 0);
  });
  await test('RPC failure, missing code and wrong RPC chain disable transactions; retry restores reads', async page => {
    const state = model({ emptyCode: true }); await setup(page, state); await page.goto(url);
    await page.getByRole('alert').filter({ hasText: 'contract code could not be verified' }).waitFor();
    state.emptyCode = false; state.wrongRpcChain = true; await page.getByRole('button', { name: 'Retry reads' }).click();
    await page.getByRole('alert').filter({ hasText: 'wrong chain' }).waitFor();
    state.wrongRpcChain = false; await connect(page);
    state.readFailure = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Retry reads' }).waitFor(); assert(await page.getByRole('button', { name: 'Approve ARBT', exact: true }).isDisabled());
    state.readFailure = false; await page.getByRole('button', { name: 'Retry reads' }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor(); assert(await page.getByRole('button', { name: 'Approve ARBT', exact: true }).isEnabled());
  });
  await test('ABI tampering fails closed before wallet actions', async page => {
    await setup(page, model());
    await page.route('**/abi/LaunchToken.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.goto(url); await page.getByRole('heading', { name: 'Deployment unavailable' }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'ABI verification failed' }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Connect wallet' }).count(), 0);
  });
  await test('Explicit pagination finds older wallet escrows; role filter is accurate', async page => {
    const state = model({ escrows: [row(0), ...Array.from({ length: 25 }, () => row(0, { buyer: OUTSIDER }))] }); await setup(page, state); await page.goto(url); await connect(page);
    await page.getByText('No matching escrows in this range', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load 25 older escrows' }).click();
    await page.getByRole('heading', { name: 'Escrow #1', exact: true }).waitFor();
    await page.getByLabel('Filter by your role').selectOption('seller'); await page.getByText('No escrows as seller in this range').waitFor();
    await page.getByRole('button', { name: 'Show all roles' }).click(); await page.getByRole('heading', { name: 'Escrow #1', exact: true }).waitFor();
  });
  await test('Rendered contrast, keyboard focus, 200% text enlargement and reduced motion', async page => {
    await setup(page, model()); await page.goto(url); await connect(page);
    const pairs = await page.evaluate(() => {
      function bg(el) { const value = getComputedStyle(el).backgroundColor; return value !== 'rgba(0, 0, 0, 0)' ? value : el.parentElement ? bg(el.parentElement) : 'rgb(255, 255, 255)'; }
      function luminance(color) { return color.match(/[\d.]+/g).slice(0,3).map(Number).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((s,v,i) => s+v*[.2126,.7152,.0722][i],0); }
      return ['h1','.intro-copy','.field-hint','.primary','.balance-value'].map(selector => { const el = document.querySelector(selector); const fg = getComputedStyle(el).color, background = bg(el); const a = luminance(fg), b = luminance(background); return { selector, foreground: fg, background, ratio: (Math.max(a,b)+.05)/(Math.min(a,b)+.05) }; });
    });
    pairs.forEach(pair => assert(pair.ratio >= 4.5, JSON.stringify(pair))); report.observations.push({ contrast: pairs });
    await page.getByLabel('Seller address', { exact: true }).focus();
    await shot(page, 'desktop-keyboard-focus.jpg');
    assert.equal(await page.getByRole('button', { name: 'Approve ARBT', exact: true }).evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.evaluate(() => document.documentElement.style.fontSize = '32px');
    await page.setViewportSize({ width: 740, height: 1000 }); await overflow(page);
    report.observations.push({ textEnlargement: '200% root font size at 740px, not native browser zoom', overflow: false });
  });
} catch { process.exitCode = 1; }
finally {
  await writeFile(resolve(output, 'interaction-results.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
