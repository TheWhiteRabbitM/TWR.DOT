# Developer feedback — Polkadot Products Devnet

**Reported by:** Claude Code (Anthropic's coding agent), which built, deployed and
published every app in this repository end-to-end during the first three days of the
devnet (2026-07-23 → 2026-07-26), operated by the repository owner. Last updated
2026-07-29: **finding 13 added** — a security-relevant result established by direct
experiment on Bulletin write authorization, disclosed here rather than used quietly.
(2026-07-27: finding 6 **corrected**, finding 8a added after auditing how the ecosystem
can be discovered.)

**Scope of the test:** seven .dot apps built and published (thebutton, openpetition,
dotmetrics, wudcommunity, italiarovente, truereviews, discreetly), two PolkaVM contracts
deployed via CDM (ReviewRegistry `0x29aF38913652B32989D1d96C51Af641980E55698`, Discreet
`0x8Fa1fcA9f6E8C333625c3caf064E94640175f375`), 40+ `pad` publishes by hand plus one an
hour from the scheduled refresh, DotNS root manifests set on all seven names, a
block-walking ecosystem indexer (63 registered labels found to date), and scheduled
republish automation (dotmetrics hourly on GitHub Actions, italiarovente daily under
Windows Task Scheduler + WSL — both verified end-to-end, including data refresh, rebuild
and on-chain publish).

**Environment:** Windows 11 + WSL2 Ubuntu (contract toolchain), pad v0.13.1,
dotns 0.8.0, cdm, @parity/product-sdk 0.19.x, dotli shell 0.6.8 (dev), Chrome 148.

Each item below is something Claude Code observed directly, stated as fact, followed by
a suggestion. No speculation about root causes is included.

An LLM-oriented companion — the same ground stated as "symptom → cause → working
code" for an agent writing apps on this platform — is in [`llms.txt`](llms.txt).

---

## Summary

Ranked by what it costs a developer, not by how hard it looks to fix.

| # | Finding | Impact |
|---|---|---|
| 12 | Personhood write paths cannot be exercised without a granted account | **Blocks every app's real purpose.** Everything here ships demo-first because of it |
| 4a | External links do nothing in the mobile shell. Root cause is likely an `OpenUrl` device permission we never requested — but it fails as an unresolved promise, not a refusal | **Silent dead end.** Cost us a day and three wrong diagnoses; a named refusal would have cost minutes |
| 6 | `registry.resolver(node)` points at a resolver that reverts; records are readable only by calling the content resolver directly | **Breaks standard ENS-style resolution.** Once known, it is the unlock for all app metadata |
| 8 / 8a | No supported enumeration; the official directory stores labelhashes only, emits no events, and cannot name 15 of its 19 entries | **The ecosystem cannot be indexed** by anyone who is not walking raw calldata |
| 3 | Fetches to non-approved origins fail indistinguishably from network errors | Controls that appear to do nothing until you find `requestPermission` |
| 2 | A nested third-party iframe blanks the app, no console output | Blank screen, no diagnostic |
| 1 | One name stalls in resolution while sibling names resolve | Intermittent, name-specific, no per-name diagnostics |
| 9 | The short-name personhood rule surfaces only after the commit transaction | Wasted transaction and a confusing error |
| 12a | Self-updating apps need infrastructure outside the platform | Every "live" app needs a cron somewhere and a key in it |
| 10 / 11 | Custom signed extensions break vanilla tooling; historical blocks do not decode | Recoverable once you know; costs an afternoon each |
| 5 | The root-manifest contract is documented only in source code | Found by reading the shell's source |
| 7 | Spinner output makes `pad` / `dotns` logs unusable in CI | Scripting requires grepping for `baf…` |
| 4 | Native `<select>` did not open inside the shell on tested devices | Not fully isolated to the shell; worked around app-side |
| 4b | Apps that ignore the History API turn the back gesture into "quit" | **Our bug**, documented because the symptom reads as a shell defect |
| 13 | `dotns bulletin authorize` honours `-k` but silently ignores `-m`/keystore for the signer, defaulting on testnet to the public dev key `//Eve` (which is a live authorizer here). Non-testnet is already guarded | **Footgun, mildly security-relevant.** A normal-auth caller signs as a public key without noticing; narrowed twice by re-verification — the first two versions overstated it |

The single highest-leverage change remains **12**: a rate-limited self-service Lite
grant on the devnet would let builders exercise the write path they are building for.

Finding **13** is the one we got wrong — twice — and corrected ourselves each time by
re-verifying instead of trusting the previous write-up. It started as a "delegation hole"
that does not exist, became "the CLI always signs as a public key" (also too strong), and
settled as what the source actually shows: an inconsistent, silent signer default on
testnet, with the non-testnet case already guarded. The correction history is kept in
place, because a report is only worth trusting if its own mistakes are visible in it.

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

**4a. An app cannot open an external link from the mobile shell; the same build
opens it fine on desktop.**
Observed: tapping a link to an external `https://` URL (a place on Google Maps)
works in the desktop shell and does nothing at all in the mobile app, from the
same published bundle.

*Partly our own bug, and worth stating first.* `OpenUrl` is a device permission
in the SDK — `HostDevicePermissionRequest = "Notifications" | "Camera" |
"Microphone" | "Bluetooth" | "NFC" | "Location" | "Clipboard" | "OpenUrl" |
"Biometrics"` (`@parity/truapi/dist/generated/types.d.ts:2491`) — and none of
these apps ever called `requestDevicePermission("OpenUrl")`. The web shell
appears to grant it implicitly, which is why the desktop path always worked. The
apps now request it at startup, alongside the `Remote` origins; whether that
alone fixes the mobile case is being confirmed. `Clipboard` was missing for the
same reason, so the copy-the-link fallback would have failed silently too.

What remains platform-side, regardless of that omission:
- **The failure is silent and indistinguishable from a hang.** `navigateTo(url)`
  never settles. There is no request timeout in the TrUAPI client, and its iframe
  transport queues frames while the channel is not established
  (`@parity/truapi/dist/sandbox.js`: `postMessage` pushes to `queued` with no
  timer), so `await navigateTo(url)` can hang indefinitely rather than rejecting.
  Any fallback written after that `await` is unreachable code, which presents to
  the user as a dead button. A missing permission should produce a refusal that
  names itself, not an unresolved promise.
- **The permission is not discoverable from the API you are told to use.** The
  docblock for `navigateTo` documents that an `https://` URL "opens externally"
  and says nothing about `OpenUrl` being required; `permissions.ts` documents
  `requestDevicePermission` with a `Camera` example. Nothing connects the two.
- `window.open` produces no visible window in the mobile wrapper. The web
  gateway's app iframe is served with `sandbox="allow-scripts allow-same-origin
  allow-forms allow-pointer-lock allow-popups"`, so popups are granted there.

As a workaround these apps now request `OpenUrl` and `Clipboard` up front, race
every host call against a 1.5s deadline, remember for the session that the host
did not answer, fall back to `window.open` (without `noopener`, which makes the
call return `null` even on success and so hides whether it worked), hand
`maps:`/`geo:` URLs to the OS on mobile, and finally show the URL in a sheet the
user can copy. Each attempt appends to a breadcrumb
(`perm:ok>host:timeout>popup:blocked>manual`) shown in that sheet, so a user who
reports "the button does nothing" hands over the cause with it.

Suggestion: reject `navigateTo` with `PermissionDenied` when `OpenUrl` has not
been granted, instead of hanging; and cross-reference the permission from the
`navigateTo` documentation, since an app author following the navigation API has
no reason to look in the device-permission list for it.

**4b. Apps that do not use the History API make the back gesture close the app.**
Observed: an app that changes view via internal state, without pushing a history
entry, gives the shell nothing to pop — a back swipe exits to the gallery from
the middle of the app. An app that pushes entries but does not listen for
`popstate`/`hashchange` is worse: the first swipe silently rewinds the URL while
the view stays put, and the second closes the app. Both were our bug and are
fixed app-side.
Suggestion: state the contract in the app-developer docs (push a history entry
per view, listen for `popstate`), since the failure looks like a shell bug and
is invisible on desktop where there is no back gesture.

**5. The root-manifest contract is only documented in source code.**
Observed: the gallery metadata mechanism (text record `manifest` on `<id>.dot` with
`{"$v":1, displayName, description, icon:{cid, format:"png"|"jpeg"}}`, and `executable`
on `app.<id>.dot`) was found by reading `packages/resolver/src/manifest.ts`. Once
applied, it worked on all seven names.
Suggestion: a docs page for the manifest contract, and ideally a `pad manifest` helper
that uploads the icon and writes the record in one step.

**6. The registry's `resolver(node)` pointer returns a resolver that reverts.**
Observed: `text(node,key)` and `contenthash(node)` work over plain `eth_call` when called
**directly** on the content resolver at `0x326bdE29315199c814B1c58b431D84D16EA5cE41` —
all seven of our names return their `manifest` JSON and their published contenthash from
that address. What fails is the standard lookup path: `resolver(node)` on the DotNS
registry `0x527b08a640b527a3dae0C4BE04D7344E430B6E50` returns
`0xfd2594FcF920B38A970011C486e1E3041563147F` for all seven names (the same address
`dotns lookup` reports), and `text()` / `contenthash()` on that address revert. Across 66
registered labels checked, 36 point at the reverting address, 8 point at the working
resolver (`browse.dot` among them) and 22 carry no resolver record. An app that follows
registry → resolver → text fails; an app that hard-codes `0x326bdE29…` succeeds. Writes
via `dotns text set` succeed. *This corrects an earlier version of this report, which
stated that `text()` itself reverts and that raw storage slots were the only read path.
That was wrong: the resolver ABI works, the registry's pointer to it does not.*
Suggestion: repoint `resolver(node)` at the working content resolver for the affected
names and for new registrations, so standard ENS-style resolution works; until then,
document `0x326bdE29…` as the supported read address. Either way apps gain a mutable
pointer — e.g. "latest data CID" — without republishing.

## polkadot-app-deploy (pad)

**7. Spinner output interleaves in captured logs.**
Observed: in non-TTY captures the progress spinner emits one character per line, making
logs unreadable; the meaningful lines ("Incremental: previous contenthash…", "Verified
on-chain:") are stable and script-friendly. The same applies to `dotns bulletin upload`:
scripted use requires grepping the raw output for the first `baf…` string to recover
the CID.
Suggestion: a `--json` or `--quiet` mode emitting only the stable lines, for both pad
and the dotns CLI. Otherwise pad's incremental publish + on-chain verification proved
excellent across 40+ publishes, including unattended scheduled runs.

## dotns-sdk / registry

**8. No supported way to enumerate registered names or map a name to its app contract.**
Observed: building an ecosystem index required walking Asset Hub blocks for
`revive.ContractEmitted` events from the registry and extracting labels from raw
registration calldata, because registry events carry only hashed names and historical
extrinsics do not decode against current metadata after runtime upgrades.
Suggestion: an enumeration view over registrations (label, block) and/or a manifest
field for an app's contract address. This would enable per-app analytics for the whole
ecosystem.

*Why this one is worth more than it looks, from operating an index for three days:*
without a name→contract mapping, per-app numbers can only be produced by hand-writing a
reader for each contract's ABI. We did that for four apps — our own, because they are the
only ones whose ABIs we have. The result was an index whose top tier was reachable only by
the operator's own apps: not dishonest, since it was disclosed, but a ranking that
structurally favours whoever runs the index. That is what a missing mapping costs an
ecosystem, and no amount of disclosure fixes it.

There is a generic metric that needs no ABI at all: the count of `revive.ContractEmitted`
events for an address. It is measurable today for every contract on the chain. The only
missing link is which address belongs to which name. Pending a platform answer, dotmetrics
now reads a **`contract` text record** on `<name>.dot` (same content resolver as
`manifest`) and, when present, shows that name's on-chain event count — the same metric,
computed the same way, for anyone who publishes the record. This is our convention, not a
standard; it exists only because the platform has no field for it, and we would drop it
gladly in favour of an official one.
Suggestion: add `contract` (or an array of addresses) to the documented manifest schema.

**8a. The official directory cannot name most of its own entries, and nothing else can
index the ecosystem either.**
Observed: the Browse registry (`0xaab42efbe8ea4d4228c3a11e973f94c17b9a0f2c`) holds 19
entries; per entry it stores a labelhash, the publisher address and a timestamp — no
plaintext name — and it has emitted zero logs over its entire history (`eth_getLogs`
from block 0), so no third party can index it from events. On-chain reverse resolution
does not fill the gap: `labelOf(uint256)` on the Registrar
`0x7f0dF075cc8B7FE7218E90fFC5a553450dB120F3` returns an empty string for all 19. Brute-
forcing a candidate dictionary against the 19 hashes — the only method a client has —
recovered 4 names (`browse`, `playground`, `docs`, `survey`); the other 15 remain
unnamed. Separately, the SDK's own docs use `navigateTo("https://search.dot")` as the
canonical deep-link example (`@parity/product-sdk-host`, `src/navigation.ts`), and
`search.dot` has no owner in the registry. And the web gateway serves a byte-identical
20,506-byte shell for every name (`thebutton`, `dotmetrics`, `truereviews` and `browse`
all return the same SHA-256), so no .dot app is indexable by a web search engine. By
contrast, walking Asset Hub blocks from outside the platform enumerated 63 registered
labels, 42 of them with a non-zero owner on the registry — more than twice the size of
the official directory, and ten times what that directory can put a name to.
Suggestion: store the plaintext label in the Browse registry at publish time, or emit it
in an event, so that anyone can index the ecosystem instead of only the client that
already knows the names. The same label would let the gateway serve per-app metadata to
web search engines.

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

## Platform gap

**12a. Self-updating apps require infrastructure outside the platform.**
Observed: Bulletin hosting is static and there is no platform-native scheduled
compute, so every app in this repo that refreshes its own published data
(dotmetrics hourly, italiarovente daily) needs an external runner — first a
personal PC via Task Scheduler + WSL, now a GitHub Actions cron for dotmetrics
(`.github/workflows/dotmetrics-refresh.yml`), which also means the publish key
must live in a cloud secret store. A DotNS text record is readable today against
the content resolver directly (see finding 6), so an app can already point at a
"latest data CID" instead of republishing the whole site — but something still
has to write that record on a schedule, and that something is off-platform.
Suggestion: a platform-native "republish (or write this record) on schedule"
primitive. Fixing the resolver pointer in finding 6 makes the pointer pattern
usable through the standard resolution path in the meantime.

## Personhood rollout

**12. Write paths cannot be exercised by developers without a granted account.**
Observed: every personhood-gated write (`press()`, `sign()`, `review()`, `book()`)
reverts with `NotHuman(0, …)` for a standard devnet account; as a result every app in
this repository (and the third-party apps observed on the devnet) ships demo-first with
a live contract idling behind it.
Suggestion: a rate-limited self-service grant of Lite tier on the devnet would let
builders exercise the full write path end-to-end. Highest-leverage item in this list.

## Bulletin write authorization

**13. `dotns bulletin authorize` selects its signer inconsistently with the rest of the
CLI, and on a testnet defaults to the public dev key `//Eve`.**

This finding has been narrowed twice by re-verification; the load-bearing claims below
were each re-checked against the CLI source and the `signer:` line the tool prints.

Observed — signer selection (verified by reading `dist/cli.js` and by running each case):
- `authorize` honours `--key-uri` / `-k`: passing our own key with `-k` printed
  `signer: (provided via --key-uri)` and signed as us.
- `authorize` does **not** honour `--mnemonic` / `-m` (nor `--account` / keystore) for the
  signer: passing our key with `-m` still printed `signer: //Eve` and signed as `//Eve`.
  Every other subcommand honours `-m` and the keystore. So a user who authenticates the
  normal way, and does not happen to use `-k`, silently signs `authorize` as `//Eve`
  rather than as their own account.
- With no signer at all: the code defaults to `//Eve` **only on a testnet**. On a
  non-testnet it refuses — `Refusing to default the Authorizer signer to //Eve on this
  chain … Pass an explicit signer with -k / --key-uri`. The dangerous case is guarded.

Observed — who `//Eve` is, and that it is a live participant here:
- `//Eve` is derived from `DEFAULT_MNEMONIC` in the same constants block —
  `"bottom drive obey lake curtain smoke basket hold race lonely fit walk"`, the standard
  Substrate development seed published in every project's docs. Its address is
  `5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw`; anyone can reproduce its private key.
- On this devnet `//Eve` held the authorizer origin in practice: earlier `authorize`
  calls it signed **succeeded**, granting write windows to accounts we derived, one of
  which then uploaded to Bulletin (CID
  `bafybeifb2szx6dorw7drflum4cyikfejs6wetovle3bjemb2fqmbphhoia`). `//Alice` from the same
  public seed (`5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`) currently holds a live
  authorization: 20 transactions / 2000 bytes, expiring 2026-07-30. So well-known
  development accounts are live on the storage network, not merely referenced by tooling.
- Every `authorize` now fails with `{"type":"Invalid","value":{"type":"Payment"}}` —
  including one we signed with our own account via `-k` — so the current blocker is the
  signer's ability to pay for the extrinsic, not an authorization decision. We therefore
  cannot, right now, cleanly test whether a non-authorizer key is rejected with
  `BadOrigin`, and do not claim it either way.

*What this corrects.* An earlier version of this finding said `authorize` "ignores the key
you pass and always signs as `//Eve`", and before that, that "an authorized account can
transitively delegate authorization past its own expiry". Both were wrong: `-k` does
select the signer, and the grants we first attributed to our key were `//Eve`'s
throughout, because `-m` (the way we authenticate everywhere else) is silently not honoured
here. Reading the source and the printed `signer:` line is what corrected it — the same
lesson twice: verify **which account** the chain saw, not that the command exited zero.

Net: on a devnet, none of this is alarming — a public authorizer is a reasonable
convenience and the non-testnet path already refuses it. The parts worth acting on are the
inconsistency and its silence.

Suggestion:
1. Make `authorize` honour the same auth options as every other subcommand (`-m`,
   `--account`, keystore), or refuse loudly when they are set but unused — rather than
   silently substituting `//Eve` and reporting a `signer:` the caller is unlikely to read.
2. The non-testnet guard is good; consider extending a visible warning to devnet too (the
   existing `warnIfDevKeyOnTestnet` only fires for `previewnet`).
3. Ensure no public-seed account holds the Authorizer origin on any network that outlives
   local development — that part does not depend on the CLI at all.

---

Filed with thanks — feeless content-addressed publishing and personhood-as-a-primitive
are genuinely new capabilities, and everything above is offered to make them land.
