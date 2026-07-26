# Developer feedback — Polkadot Products Devnet

**Reported by:** Claude Code (Anthropic's coding agent), which built, deployed and
published every app in this repository end-to-end during the first three days of the
devnet (2026-07-23 → 2026-07-26), operated by the repository owner.

**Scope of the test:** seven .dot apps built and published (thebutton, openpetition,
dotmetrics, wudcommunity, italiarovente, truereviews, discreetly), two PolkaVM contracts
deployed via CDM (ReviewRegistry `0x29aF38913652B32989D1d96C51Af641980E55698`, Discreet
`0x8Fa1fcA9f6E8C333625c3caf064E94640175f375`), ~30 `pad` publishes, DotNS root manifests
set on all seven names, a block-walking ecosystem indexer, and scheduled republish
automation.

**Environment:** Windows 11 + WSL2 Ubuntu (contract toolchain), pad v0.13.1,
dotns 0.8.0, cdm, @parity/product-sdk 0.19.x, dotli shell 0.6.8 (dev), Chrome 148.

Each item below is something Claude Code observed directly, stated as fact, followed by
a suggestion. No speculation about root causes is included.

---

## dotli-community (shell / resolver)

**1. One name stalls in resolution while sibling names resolve.**
Observed: `openpetition.dot` repeatedly stopped at "Resolving… 50% — the RPC endpoint is
slow to answer the resolver query" (Trusted backend), across multiple attempts over two
days and after a full cache wipe from Settings. `thebutton.dot` and `dotmetrics.dot`
resolved normally from the same shell within the same minutes. `dotns lookup` shows the
three names with structurally identical on-chain records (owner, resolver, store), and
`dotns content view` returns the expected contenthash for all three.
Suggestion: add per-name diagnostics to the resolver progress screen (which query is
pending, against which endpoint) so a stuck name can be distinguished from a stuck
endpoint.

**2. A nested third-party iframe blanks the app with no console output.**
Observed: an app page containing `<iframe src="https://www.openstreetmap.org/export/embed.html…">`
rendered as a blank screen inside the shell; no error appeared in the console. The same
build works in a normal browser. Replacing the iframe with plain `<img>` tiles resolved it.
Suggestion: if nested browsing contexts are disallowed, block them visibly (console error
naming the policy, and/or a placeholder frame) instead of silently failing.

**3. Fetches to non-approved origins fail without a distinguishable error.**
Observed: before calling `requestPermission({ tag: "Remote", value: { domains } })`,
`fetch()` calls to external origins failed indistinguishably from network errors. In the
UI this presented as controls that appeared to do nothing.
Suggestion: reject gated fetches with a distinctive error (or log a console warning
naming the blocked origin and the permission API), so the permission model is
discoverable from the failure.

**4. Native `<select>` dropdowns did not open inside the shell on tested devices.**
Observed: users of these apps reported dropdown menus not opening inside the Polkadot
app across multiple apps; the same builds work in normal browsers. Not fully isolated to
the shell (app-side CSS cannot be excluded); all selects were replaced with custom
pickers as a workaround.
Suggestion: confirm whether popup form controls are expected to work inside the
sandboxed iframe; if constrained, document it so developers design around it up front.

**5. The root-manifest contract is only documented in source code.**
Observed: the gallery metadata mechanism (text record `manifest` on `<id>.dot` with
`{"$v":1, displayName, description, icon:{cid, format:"png"|"jpeg"}}`, and `executable`
on `app.<id>.dot`) was found by reading `packages/resolver/src/manifest.ts`. Once
applied, it worked on all seven names.
Suggestion: a docs page for the manifest contract, and ideally a `pad manifest` helper
that uploads the icon and writes the record in one step.

**6. ENS-style `text(node,key)` reverts on the content resolver via `eth_call`.**
Observed: reading a text record through the standard resolver ABI reverts; records are
readable via raw storage-slot access (the approach the shell itself uses). Writes via
`dotns text set` succeed.
Suggestion: either expose a working view function (this would give apps mutable
pointers — e.g. "latest data CID" — without republishing), or document the raw-slot
layout as the supported read path.

## polkadot-app-deploy (pad)

**7. Spinner output interleaves in captured logs.**
Observed: in non-TTY captures the progress spinner emits one character per line, making
logs unreadable; the meaningful lines ("Incremental: previous contenthash…", "Verified
on-chain:") are stable and script-friendly.
Suggestion: a `--json` or `--quiet` mode emitting only the stable lines. Otherwise pad's
incremental publish + on-chain verification proved excellent across ~30 publishes.

## dotns-sdk / registry

**8. No supported way to enumerate registered names or map a name to its app contract.**
Observed: building an ecosystem index required walking Asset Hub blocks for
`revive.ContractEmitted` events from the registry and extracting labels from raw
registration calldata, because registry events carry only hashed names and historical
extrinsics do not decode against current metadata after runtime upgrades.
Suggestion: an enumeration view over registrations (label, block) and/or a manifest
field for an app's contract address. This would enable per-app analytics for the whole
ecosystem.

**9. The short-name personhood requirement surfaces only after the commit transaction.**
Observed: `dotns register domain -n discreet` (8 chars) completed the commit step and
then failed with "Requires Full Personhood verification".
Suggestion: pre-flight the name-length/tier rule in the CLI before the commit tx, and
state the rule in the pricing docs.

## Chain / tooling

**10. Custom signed extensions are not handled by vanilla polkadot.js / PAPI.**
Observed: transactions built with standard tooling (e.g. `limited_teleport_assets`) fail
against the devnet's signed-extension set (`AsPgas`, `AsPerson`, …) even with fresh
descriptors; the Product SDK signer handles them correctly.
Suggestion: a docs note listing the custom extensions and stating that the SDK signer is
the supported signing path.

**11. Historical block decoding fails against current metadata.**
Observed: `chain_getBlock` + extrinsic decoding via @polkadot/api errors with
`findMetaCall: Unable to find Call with index` on blocks from before a runtime upgrade;
event decoding via `system.events` works. The indexer therefore uses events + raw block
bytes.
Suggestion: none needed if this is expected Substrate behaviour — a line in the devnet
docs would confirm the supported pattern (events + raw calldata).

## Personhood rollout

**12. Write paths cannot be exercised by developers without a granted account.**
Observed: every personhood-gated write (`press()`, `sign()`, `review()`, `book()`)
reverts with `NotHuman(0, …)` for a standard devnet account; as a result every app in
this repository (and the third-party apps observed on the devnet) ships demo-first with
a live contract idling behind it.
Suggestion: a rate-limited self-service grant of Lite tier on the devnet would let
builders exercise the full write path end-to-end. Highest-leverage item in this list.

---

Filed with thanks — feeless content-addressed publishing and personhood-as-a-primitive
are genuinely new capabilities, and everything above is offered to make them land.
