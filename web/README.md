# Arbiter frontend

One static page for ARBT escrows on the deployed Sepolia contracts. Source is in `web/`; the production export is `../dist/`. The publisher serves the committed export without rebuilding. No backend, indexer, wallet keys, private RPC credentials, swap UI or contract changes are included.

## Install, build and preview

Use Node.js 22.18+ (validated with 22.22.2) and npm 10+. From the repository root:

```sh
npm --prefix web ci --cache /tmp/arbiter-npm-cache
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run check:export
npm --prefix web run preview -- --host 127.0.0.1
```

`build` runs Vite with `base: './'`, writes `dist/`, copies pinned ABIs, verifies their hashes, and writes `dist/imd-deployment.json` **last**. Serve `dist/` over HTTP(S); opening `index.html` using `file://` cannot load its JSON configuration. The page uses fragment links and works under a static gateway subpath without rewrites. All scripts, styles and ABIs are local assets; no CDN fonts or scripts are needed. `npm --prefix web run dev` supports source development after a build. Its Vite middleware serves the same deployment manifest and ABIs from `dist/`; production preview and tests validate the actual export.

The build needs the deployed source commit in Git history. It fails rather than silently substituting current ABIs if the pinned commit is unavailable or a checked-in ABI differs. Do not edit the deployed Solidity source or regenerate different ABIs for this frontend.

## Deployment configuration

The only **runtime** configuration is `dist/imd-deployment.json`, loaded by `src/config.ts`. The app fetches its `abiPath` files and verifies canonical Keccak hashes before rendering wallet controls. No contract address, RPC URL, chain ID or embedded ABI map exists in application source.

`web/deployment.json` and `web/network.json` are preserved build inputs copied from the supplied handoffs. The export script obtains raw ABI arrays with `git show <sourceCommit>:docs/abi/<Contract>.json`, compares them byte-for-byte to the checked-in arrays and verifies the handoff hashes. The manifest copies the complete attested contract set, launch ID, chain ID, source commit, attestation hash and unchanged network object. It additionally carries the exact `walletAddChain` object. Its SHA-256 inventory covers every other file, excluding itself. Run the build after **any** export change, then `check:export`.

These hashes bind this export to the supplied handoff; the browser does not independently verify an attestation signature or compare deployed bytecode to compiler output. It checks configured RPC chain ID, nonempty code for both contracts, token metadata, and `ArbiterEscrow.token()` against the manifest token before enabling transactions. Token reads use the address returned by `token()`.

Public RPC endpoints are attempted in handoff order, followed by the connected provider when it is on the required chain. Signing always uses the visitor’s wallet. Only browser wallets are supported (EIP-6963 discovery, plus injected EIP-1193 fallback). No WalletConnect project ID was supplied, so no WalletConnect or QR connector is configured. A wallet missing Sepolia receives `wallet_addEthereumChain` after a 4902/unknown-chain switch failure, then a second switch request. The exact add-chain parameters come from the runtime manifest; see [EIP-3085](https://eips.ethereum.org/EIPS/eip-3085).

The unchanged network object retains its Uniswap addresses. The approved workflow explicitly says **no in-page swap**: the page explains that ARBT comes from swapping Sepolia ETH in the project launch pool. No router, quote, swap approval or liquidity transaction is constructed here. Escrow approval goes to the deployed escrow, as required by `open`.

## Contract interactions

- Live wallet ARBT balance, escrow allowance and withdrawable balance are read at a common block. Amounts retain all 18 decimal places with bigint arithmetic. Account changes clear account-specific views; wrong chains and read/verification failures disable transactions.
- New escrows require three distinct nonzero addresses, a positive amount within the wallet balance, and agreement on off-chain terms. **Approve ARBT** sets the exact deposit allowance; **Open escrow** transfers the amount only after sufficient confirmed allowance. Existing sufficient allowance satisfies the first step; there is no unlimited approval.
- Each transaction gets an explicit review of its effect, parties and amounts. The app verifies wallet account/chain, simulates the call, checks the wallet again, then asks it to sign. Rejections, simulation reverts, pending hashes, confirmations and failures are visible with explorer links. Receipt timeouts retain the pending state and offer confirmation rechecking, without automatically resending. Repricing uses the replacement receipt; cancelled/different replacements are not described as the requested action succeeding.
- Cards expose every escrow action according to role, state and the **latest read block timestamp**: markDelivered, release, refund, cancel, dispute, resolve, claimAfterDelivery and timeout. Eligible deadline controls enable at the exact contract boundary after refresh. Resolve previews the 1% fee and both parties’ exact credits. Withdraw collects only the caller’s full credited ARBT.
- Discovery enumerates `escrowCount()` and `escrow(id)` views, newest first, 25 IDs initially with five concurrent calls. The page explicitly shows examined/matching counts; **Load 25 older escrows** expands the inspected range. No matches in the first range does not imply no older agreements. **Find an escrow by ID** lets any connected wallet reach the permissionless dispute timeout. Refresh reloads selected ID state too. Reads refresh every 30 seconds, after receipts, and on demand. Large histories require additional RPC requests and pagination.

## Agreement and custody assumptions

Delivery and identity are agreed off-chain. The buyer chooses the arbiter and may control it; the seller must agree to the arbiter and terms before marking delivery, or can refund. There is no app administrator, pause, upgrade or dispute override. The contract holds ARBT while an escrow is active; closing credits balances rather than pushing payment. Recipients must withdraw, paying Sepolia ETH gas.

The buyer can release while Funded or Delivered; the seller can refund in either state. Cancel requires Funded and 14 days from opening. A seller’s claim requires Delivered and 30 days from delivery. Dispute is available only to buyer/seller in Delivered. The arbiter can resolve Disputed with 0–100% of the post-fee remainder for the buyer; the contract floors its 1% fee and buyer share, leaving the rest for the seller. After 60 days from dispute, anyone can trigger an equal split without fee; an odd minor unit goes to the buyer.

First transaction wins: `markDelivered` can prevent `cancel` at day 14; `dispute` can prevent `claimAfterDelivery` after day 30. Resolve and timeout also compete for the same unsettled funds. A simulation is a point-in-time check; later state changes can still make a signed transaction revert. The page never suggests that arbitration proves delivery or that a simulation guarantees execution.

## Validation

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/arbiter-playwright-browsers npm --prefix web exec -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/arbiter-playwright-browsers npm --prefix web test
npm --prefix web run check:live
npm --prefix web audit --cache /tmp/arbiter-npm-cache
```

The test command manages its preview and Chromium in one foreground process, serving the production export at `/preview/` and closing both afterward. Wallet and RPC transactions are mocked in `tests/`, never in production source. It writes evidence to `docs/frontend/`; scratch failure screenshots go to `test/scratch/`. The live check performs read-only RPC requests. Neither command broadcasts a real transaction.

See [validation](../docs/frontend/VALIDATION.md), [interaction results](../docs/frontend/interaction-results.json), [live read evidence](../docs/frontend/live-read-check.json) and [design system](../docs/DESIGN.md). Real wallet extension signing, live payments/swaps, mainnet, screen-reader sessions, native mobile devices, native browser zoom and publication checks are not claimed as tested.

## Scope and package budget

Only `web/**`, `dist/**` and `docs/**` are delivered. The explicit ignore-file path budget is **`web/.gitignore` only**; its recursive dependency/cache exclusions apply only inside `web/`. No other ignore file is changed. Dependencies are installed normally; node_modules, browser binaries, caches, npm archives and registries are not part of the submission.

The root `DESIGN.md` request conflicts with the overriding allowed-path list. Its complete content is delivered at `docs/DESIGN.md`. Root Foundry/build files, existing contracts, ABIs, libraries and Git submodules remain unchanged. Source publication and IPFS/site naming belong to the publisher; this worker does not publish or deploy.
