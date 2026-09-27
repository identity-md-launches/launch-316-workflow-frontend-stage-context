# Frontend validation

Worker evidence for the permitted Arbiter frontend scope. These checks are self-reported and carry no independent certification of contract behavior or publication.

## Scope, authority and assumptions

Read inputs: the supplied workflow, deployment and network JSON, both protected Solidity checks, the implementation contracts/ABIs, and Better Interface’s workflow, core principles in all six domains, and documentation section. The protected tests are deployment/token baselines, not frontend behavioral tests; they and deployed Solidity were not changed or rerun.

The approved workflow explicitly requires a small page and **no in-page swap**. Implemented: wallet connection, chain recovery, ARBT balances and allowance, exact approval before payment, all escrow actions, caller withdrawal, role filtering, ID lookup, transaction review/status and contract links. Uniswap metadata is preserved unchanged; no swap control or transaction exists. The user’s allowed-path rule overrides the root `DESIGN.md` requirement, so design documentation is at `docs/DESIGN.md`.

One native browser-wallet flow supports EIP-6963 and injected EIP-1193. No WalletConnect ID was provided. Reads use public RPCs with a connected-wallet fallback. Discovery uses paginated contract views; there is no indexer or backend. A 30-second refresh cadence and manual Refresh keep deadline controls tied to chain time, not the visitor’s clock. Screenshots containing balances or escrow cards use mock accounts and dates; they do not claim live funded escrows.

## Commands and outcomes

Executed from the repository root on Node 22.22.2 / npm 10.9.7:

| Check | Outcome |
| --- | --- |
| `npm --prefix web run typecheck` | Passed (TypeScript strict, no emit) |
| `npm --prefix web run build` | Passed; relative Vite static export plus final manifest generated; both pinned canonical ABI hashes matched |
| `npm --prefix web run check:export` | Passed; six assets, 549,865 export bytes including manifest; complete inventory, SHA-256, pinned raw ABIs, network and walletAddChain equality |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/arbiter-playwright-browsers npm --prefix web test` | Passed: 15 result groups, including 14 Chromium scenarios and domain assertions |
| `node web/scripts/check-live.mjs` | Passed on all three handoff RPCs; detailed read evidence in `live-read-check.json` |
| `npm --prefix web audit --cache /tmp/arbiter-npm-cache` | Zero vulnerabilities after dependency corrections |
| Bounded Vite development-server check | Passed; development middleware returns the exact production manifest and both ABI files |
| Scratch Git bundle audit | Passed; approximately 1.16 MiB for complete proposed history, under 8 MiB; 40 changed paths all in scope; no submodules or dependency artifacts |
| `git diff --check` | Passed for existing tracked content; new-file whitespace/path checks and scratch packaging audit also used |

Final Vite 7.3.6 build reports a non-failing size advisory for the 513.10 kB main JavaScript chunk (159.45 kB gzip). The complete export is approximately 0.525 MiB; required runtime assets remain included. A split solely to silence that advisory would not reduce the total transfer size. No source maps, npm packages, registry archives or browser binaries are exported.

Browser engine: Chromium 141.0.7390.37 through Playwright 1.56.1. The supplied browser MCP could not initialize: `EROFS` when creating `/home/imd/.cache/ms-playwright/b/browser@…`. Instead, Chromium was installed into `/tmp/arbiter-playwright-browsers`. The delivered test runner served `dist/` at a real `/preview/` subpath in one bounded foreground process and closed its server/browser. No background service was left running.

## Interaction evidence

`interaction-results.json` records all checks and measured values. Mocked RPC calls use the production ABI encoders/decoders; the production JavaScript, controls, validation, wallet adapter and transaction code run unmodified. Unknown external requests are blocked. No real transaction was broadcast.

- Role/state action matrix: all 16 role/state combinations; each 14/30/60-day boundary at minus one second, exact boundary and plus one second. One-wei amounts and excessive decimal precision tested; 1,000 bigint resolution splits conserve the total exactly.
- Disconnected page and missing-wallet recovery; wrong chain and switch → add exact handoff parameters → switch; wrong RPC chain, missing contract code, RPC errors and retry; ABI tampering fails closed.
- Keyboard form validation, first invalid field focus, exact approval, confirmed allowance, open, simulated signature and receipt refresh. Review cancellation sends nothing. Buyer release and cancellation; seller delivery, refund and post-delivery claim; buyer dispute; arbiter split preview/validation/resolution; outsider lookup and timeout; seller withdrawal and refreshed balances.
- Simulation revert sends no transaction; rejection is recoverable; a reverted receipt stays a failure. Account/network changes close review and disable ineligible actions. Explicit pagination finds older wallet escrows and role filtering updates results.
- Lookup refresh updates a stale state, and duplicate list/lookup cards have unique accessible input IDs. Primary confirmation uses the latest connected wallet refresh callback after asynchronous work.
- Relative static assets load; no page errors, console errors, failed resources or unexpected external requests occurred in the asserted normal flows. Expected mocked RPC failures are handled by the app and are not reported as clean network requests.

## Better Interface coverage

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility | **Checked.** Native buttons/fields/disclosures/dialog; labels and descriptions; first-invalid focus; keyboard approval and modal Escape/focus return; textual statuses; disabled prerequisites; axe WCAG 2 A/AA, 2.1 AA and 2.2 AA scans passed on disconnected, seller, disputed card, duplicate-card and modal states. Visible field and Refresh focus inspected in screenshots. | No screen-reader session, full keyboard walkthrough of every settlement, forced-colors rendered test or assistive-device testing. Axe is not a conformance certification. |
| Layout | **Checked.** Production export at 1440, 1024, 740, 390 and 320 CSS pixels; no horizontal overflow; screenshot review of desktop and mobile; long addresses and exact decimals fit; 200% root-text enlargement at 740px. Normal document flow keeps actions reachable. | Text enlargement is not native browser zoom. No RTL/localization variant; English LTR only. |
| Writing | **Checked.** Labels match contract actions; review states token movement versus credit; no-wallet/RPC rejection errors suggest a next step; empty states explain ranges; risks cover buyer-chosen arbiter, fee, pull withdrawal and both specified races. | No user research or translated copy. |
| Typography | **Checked.** H1/H2/card scale, 16px inputs, unitless line height, text measure and tabular exact amounts reviewed in source and screenshots; full addresses wrap. | No downloaded font is used. Exact installed fallback face can vary across operating systems. |
| Colors | **Checked.** Semantic roles extracted from source; measured rendered foreground/background ratios in `interaction-results.json`; axe checks relevant rendered states. Text labels accompany every status. | No dark theme (not applicable); not every focus-adjacent pair, hover, status or forced-colors combination was manually measured. |
| UI | **Checked.** Empty, loading, disabled, focused, error, pending and confirmed states exercised; native modal with explicit consequences; controls at least 44px high; reduced-motion setting yields zero button transition duration. Screenshot surfaces and visible focus reviewed. | Slow-motion replay, physical touch testing, native wallet extension UI and every hover state not manually reviewed. No image/gallery/theme system exists. |

Representative measured contrast: heading/canvas **13.01:1**; secondary introduction/canvas **6.02:1**; field hint/surface **6.41:1**; primary-button text/fill **10.18:1**; balance text/surface **13.85:1**. These are computed from the actual rendered colors, not estimated from screenshots.

## Findings, corrections and rechecks

| Severity | Location | Evidence, effect and correction | Recheck |
| --- | --- | --- | --- |
| Low | `web/src/style.css:145` | Screenshot review of the funded state showed the explorer link touching the confirmation sentence. The link now occupies its own line with a 6px top gap. | Final funded screenshot regenerated and visually rechecked. |
| Medium | `web/src/App.tsx:53` | Source review found that Refresh originally reloaded only the wallet list, retaining an older ID lookup tuple. That could present obsolete actions. It now reloads the selected ID at the same snapshot block and ignores obsolete async results. | Regression changes a lookup’s state to Closed and refreshes: both cards update and Resolve disappears. |
| Medium | `web/src/App.tsx:236` | A list card and ID lookup for the same disputed escrow initially shared percent-input IDs. Labels could target the wrong instance. Per-instance `useId()` values now identify the field and description. | Duplicate-card regression asserts unique IDs and passes axe. |
| Medium | `web/src/App.tsx:77` | Receipt completion could invoke a stale account’s refresh closure after a wallet change. It now invokes the latest refresh callback. | Existing account/network-change and receipt-refresh scenarios pass. The exact mid-receipt account race was source-reviewed, not independently timed in a browser. |
| Medium | `web/src/gateway.ts:62` | A successful receipt for a cancelled/different replacement could previously be described as success for the intended call. Non-repricing replacements now terminate as cancelled/replaced; repricing uses the returned hash. | Typecheck and receipt success/revert tests pass. Real replacement/cancellation detection remains unperformed. |
| Medium | `web/package.json:17` | Audit found vulnerabilities in initial Vite/viem transitive dependencies. Updated viem to 2.56.9, Vite to 7.3.6 and its React plugin to 5.2.0, regenerated the lockfile, rebuilt and retested. | Final npm audit reports zero vulnerabilities. |

No clipping, horizontal overflow or blocking contrast defect was observed in the rendered states inspected. Findings above were implementation/source findings, not invented visual observations. Design documentation describes the corrected implementation.

## Screenshots inspected

- `desktop-disconnected.jpg`: 1440px, missing wallet recovery and visible Refresh focus.
- `desktop-funded-mock.jpg`: 1440px, approved/opened mock escrow, full-precision balance and role controls.
- `desktop-keyboard-focus.jpg`: 1440px, connected empty state and focused seller field.
- `mobile-320-disconnected.jpg`: 320px reflow with stacked controls.
- `mobile-dispute-mock.jpg`: 390px, full party addresses and arbiter split preview.
- `mobile-review-mock.jpg`: 390px, explicit resolution review and native modal.

These were regenerated from the final production build. Full-page modal screenshots include content beyond the viewport; the native backdrop covers the active viewport, not a fictional full-page overlay.

## Live-chain and publication limits

Read-only calls on all three configured RPCs returned chain 11155111, nonempty LaunchToken code (1,722 bytes), nonempty ArbiterEscrow code (4,831 bytes), matching `token()` binding, 18 decimals and zero existing escrows at the check time. `live-read-check.json` includes timestamp and URLs. This does not establish arbitrary contract correctness or guarantee later RPC availability.

No real wallet signing, funded escrow, token approval, payout, gas estimation with real funds, mined replacement/reorg, public gateway publication or IPFS naming was attempted. Wallet rejection and contract transitions were tested with mocks. Receipt timeout/recheck UI was source-reviewed; the 120-second real timeout was not waited out. One confirmation is used, and reorg/finality guarantees are not claimed. Screenshots are not native mobile or screen-reader evidence.

## Delivery status

**Implementation and worker validation complete within the permitted paths.** `docs/DESIGN.md` is the permitted replacement for the conflicting root path. Build source, lockfile, deployment inputs, tests, production files and evidence are present. Existing contracts, ABI exports, Foundry settings, libraries and root build configuration are unchanged; no submodule or dependency/cache artifact is added.

Git staging/commit is **blocked by the workspace filesystem**, not awaiting permission: `git add -- web dist docs` failed because `.git/index.lock` could not be created on the read-only `.git` directory. The publisher must capture the supplied files. A separate Git packaging audit in `test/scratch/` checks the full proposed repository history plus these paths against the 8 MiB bundle limit without modifying the protected Git metadata. Temporary audit files are not deliverables.

Fixed-CID, named entrypoint, HTTP hash and RPC publication checks are subsequent control-plane work. No published URL or CID is asserted here.
