# Arbiter interface design

## Overview

Arbiter is a single-page workspace for buyers, sellers and arbiters managing ARBT agreements. The implemented design uses a warm off-white canvas, dark green text, serif introduction and compact sans-serif controls. A brief introduction leads into live balances, an open-escrow form and role-filtered agreement cards. Contract details, timestamps and longer risk explanations use native disclosures. This is a new design inferred from the assignment, not a pre-existing brand system.

Source of truth: `web/src/style.css` for tokens and layout, `web/src/App.tsx` for page/component patterns, and `web/src/domain.ts` for action labels and explanations. The product is English, left-to-right and light-theme only.

## Colors

The canonical format is hex. Components use semantic CSS properties that refer to the primitive values in `style.css:1`.

| Semantic role | Token | Value |
| --- | --- | --- |
| Canvas | `--page` | `#f5f4ee` |
| Panel/input surface | `--surface` | `#fcfbf8` |
| Inset/disabled surface | `--subtle` | `#e9e8df` |
| Primary text | `--text` | `#202d26` |
| Secondary text | `--muted` | `#565f55` |
| Structural border | `--border` | `#d2d3c8` |
| Input/button outline | `--input-border` | `#80867b` |
| Primary action | `--accent` | `#2c4439` |
| Primary hover | `--accent-hover` | `#1e3429` |
| Primary button text | `--on-accent` | `#fcfbf8` |
| Success surface/text | `--success-bg`, `--success-text` | `#e5ede5`, `#2c4439` |
| Error surface/text | `--error-bg`, `--error-text` | `#fff0e7`, `#8a3424` |
| Warning surface/text | `--warning-bg`, `--warning-text` | `#f5edda`, `#765314` |
| Keyboard focus | `--focus` | `#315eac` |

Status badges include words, never color alone. Green fill emphasizes the current payment step; other actions use outlined neutral buttons. Measured rendered contrast: primary text on canvas 13.01:1, muted introduction 6.02:1, field hint on surface 6.41:1, primary button text 10.18:1, balance value on surface 13.85:1. Exact samples are in `frontend/interaction-results.json`; these measurements are not a claim that every possible state was measured manually.

## Typography

The body stack is `'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif`. The introduction uses `Georgia, 'Times New Roman', serif`; addresses use `ui-monospace, SFMono-Regular, Consolas, monospace`. No webfont files or remote font dependencies exist. Actual installed fallback faces vary by platform; CSS family declarations do not guarantee Segoe UI or Georgia is installed. `font-synthesis: none` is set; the browser screenshots establish legibility on the worker, not identical typography on all operating systems.

Body text defaults to 16px/1.55 at weight 400. Controls use weight 600. H1 is `clamp(2.5rem, 4.9vw, 3.75rem)` with 1.08 line height, weight 400 and −.035em tracking; its second line is italic. H2 uses 1.5rem/1.2, weight 600 and −.025em tracking. Card headings use 1rem. Body descriptions use .875–.9375rem; labels use .8125rem; hints use .75rem. Eyebrows use .6875rem, weight 600, uppercase and .14em tracking. Numbers use tabular figures. Inputs stay at 16px. Headings balance wrapping; body copy uses `text-wrap: pretty`; full addresses and exact token amounts can wrap anywhere.

Introductory copy is capped at 44ch, section copy at 50ch and expanded agreement terms at 75ch. Values are not visually rounded or truncated; only the header wallet link uses a short address, with the full address in its title and deployment disclosure.

## Layout

`.shell` has a maximum width of 1160px, centered with 40px desktop gutters. Spacing tokens are 4, 8, 12, 16, 24, 32 and 48px, with local optical/component adjustments. The introduction uses a 1.45:1 two-column grid. The workspace uses `minmax(0, .86fr)` and `minmax(0, 1.14fr)` with 32px gap. The form stays first in DOM order. Balances use three columns; the timeout explanation has three equal columns.

At 1000px, gutters become 24px, the workspace gap becomes 22px, padding tightens, payment steps stack in the narrower form and withdrawal content can stack. At 740px, gutters become 16px and intro, balances, workspace and agreement rules become single-column. The payment steps can share a row again in the full-width form. At 380px, payment steps, dialog actions and lookup controls stack, and the wordmark shrinks. No action is fixed over content.

Reflow was tested at 320, 390, 740, 1024 and 1440 CSS pixels. A 200% root-font enlargement at 740px also had no horizontal overflow. This is not a native browser zoom test. Mobile screenshots are emulator viewports, not device evidence.

## Elevation & Depth

The page is predominantly flat. Thin borders organize panels and input surfaces. The native review dialog alone has an elevated shadow (`0 15px 70px #0003`) over a `#202d2699` backdrop. Its background becomes inert through native `showModal()`. There are no marketing gradients, image overlays, floating toolbars or competing elevations.

## Shapes

Controls use `--radius-control: 8px`; panels use `--radius-panel: 16px`. The dialog uses 20px. Step markers and the empty-state mark are circles; statuses are small rectangular badges with 5px corners. Corners distinguish controls, cards and the elevated review surface without adding a second shape system.

## Components

All patterns below live in `web/src/App.tsx` and are styled in `web/src/style.css`; they are local components, not an exported component package.

- **Field**: persistent label, description, optional ARBT suffix and linked validation error. Address fields permit pasting and wrapping is handled in read-only displays. The first invalid field receives focus on submission.
- **Balance**: a label, exact token value and brief explanation. Disconnected values are “— ARBT”, never invented zero balances. Withdrawal has a separate button and review.
- **EscrowCard**: ID, textual state, amount, connected role, opening date, party/timestamp disclosure and eligible actions. Resolve adds a buyer-percent input and exact split preview. Per-instance React IDs keep duplicate list/lookup cards accessible.
- **Payment steps**: outlined pending actions and one green current action. Adequate confirmed allowance changes the first step to “Allowance ready”. Opening remains disabled until approval and other prerequisites are satisfied.
- **Review dialog**: consequence first, exact amounts/addresses in a definition list, then Go back and a verb-specific confirmation. Initial focus is on Go back; Escape closes it, native Tab navigation stays inside, and cancelling returns focus to the trigger.
- **Notices**: persistent network/read errors and transaction status with links. `role="alert"` identifies errors; a stable polite `role="status"` announces transaction progression. Loading, empty and disconnected states provide an explanation and next action.
- **AddressLink**: full address with an explorer destination and decorative arrow. External links use `rel="noreferrer"`; no third-party badge images are loaded.

Buttons and inputs have at least 44px minimum height. Keyboard focus is a 3px blue outline with a 3px offset and a forced-colors `Highlight` fallback. Hover changes the surface/outline; disabled controls stay visible. Motion is limited to 120ms button color/border/scale transitions, with .96 press scale and `cubic-bezier(0.2, 0, 0, 1)`. It is enabled only under `prefers-reduced-motion: no-preference`.

## Do's and Don'ts

Reuse `.shell`, the semantic color tokens, `Field`, `.panel`, `.notice` and `.small`. Use native form and disclosure elements, preserve 16px input text and allow full token precision. Keep role/state/time eligibility separate from presentation. A new transaction needs a concrete review and the same verified signing path.

Use green fill for the current primary step; retain text labels on all statuses. Do not add an independent deployment map, hide addresses behind ellipses in reviews, round away minor units or present unverified reads as spendable funds. Do not add an in-page swap to this workflow.

For a future page, start with `.shell`, one H1, section headings and a single-column DOM order; reuse the existing form/card patterns, then test at 320px and the grid breakpoints. Additional routes would need hash routing or their own static exports. The current assignment intentionally ships just one page.

## Attribution and scope

Design guidance: Jakub Krehel’s [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`, MIT. Documentation method: Paul Bakaus’s [Impeccable document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`, Apache-2.0. These references informed the implementation; this document describes the final source, not copied guide text. Each upstream work retains its own license.

This document is under `docs/` because the overriding assignment only permits `web/**`, `dist/**` and `docs/**`; a repository-root `DESIGN.md` is outside that boundary.
