# Four issues for the products devnet, with evidence — and three claims withdrawn

All four are filed at
[Polkadot-Community-Foundation/products-devnet-issues](https://github.com/Polkadot-Community-Foundation/products-devnet-issues):
Issue 1 is [#13](https://github.com/Polkadot-Community-Foundation/products-devnet-issues/issues/13),
Issue 2 restates [#9](https://github.com/Polkadot-Community-Foundation/products-devnet-issues/issues/9),
Issue 3 is [#14](https://github.com/Polkadot-Community-Foundation/products-devnet-issues/issues/14),
Issue 4 is [#15](https://github.com/Polkadot-Community-Foundation/products-devnet-issues/issues/15).

Written after building **chirponchain.dot**, a text-only social app that keeps
everything in Asset Hub contracts. Every line below came out of a probe that
ships inside the app and runs in the container: chirp → Settings → Diagnostics.

Environment for all of it:

```
Android 17, Android WebView (Chrome 150.0.7871.181)
@parity/truapi 0.5.1
@parity/product-sdk-host 0.14.1
products devnet, Asset Hub genesis 0xd6eec261…
2026-08-04T08:02Z
```

---

## First, three things this project was about to report and did not

A draft of this file claimed the container blocked remote images, refused the
`Remote` permission, and left `navigateTo` hanging. **All three are wrong.**
Measured inside the Polkadot app:

```
[YES] Remote permission granted for media.tenor.com, i.giphy.com
      answered in 17ms: {"ok":true,"value":true}
[YES] fetch  https://i.giphy.com/…gif    HTTP 200 in 438ms
[YES] <img>  https://i.giphy.com/…gif    480x270 in 501ms
[YES] navigateTo(https://polkadot.com)   settled in 10ms: {"ok":true}
```

The permission is granted and remote images render. `navigateTo` settles
promptly with `ok` — which is all this test ever showed, and reading it as "so
links open" was a mistake this file made for a day. It settles. It does not
open. That is Issue 3 below, and finding it took instrumenting the app rather
than trusting a return value.

Each of the other "limits" was a symptom of a bug on our side —
a key encoded two bytes over a contract's field limit, a gas figure sized for a
different kind of write — that we had explained to ourselves as a platform
constraint. Reporting them would have cost somebody a day chasing nothing.

Which is the reason for the probe, and the reason the three issues below are worth
reading: they are what survived the same test.

---

# Issue 1 — `remote_preimage_submit` fails to decode its own response

**Severity: this blocks every app that accepts a picture from a user.**

With the permission granted, submitting a preimage throws inside the client's
codec:

```
[YES] PreimageSubmit permission     {"ok":true,"value":true}
[NO ] preimage submit               threw: Unknown enum discriminant: 236
```

### What it looks like from here

`236` is not a wire discriminant — the generated table puts `PREIMAGE_SUBMIT` at
`{request: 68, response: 69}`, and every entry is well under 100. It is a SCALE
**variant index inside a payload**, so the client is reading a response, or an
error, whose shape its codec does not know. That reads as a version skew between
this client (`@parity/truapi 0.5.1`) and the host build, rather than anything
wrong with the request.

### Why it matters more than one failing call

`getPreimageManager()` is the only upload path an ordinary user has. The
Bulletin storage-pool accounts a publisher draws from need an authorisation
users cannot obtain (see Issue 2 below, and #9). So while this is broken, **no
app on this devnet can accept an image, an avatar, or any file from anybody.**

It also explains something we misdiagnosed for a week. Profile pictures stored
this way came back only on the device that had set them, and we blamed Bulletin
retention. They were never stored: the submit was failing, and the app was
showing its own in-memory copy.

### It is Android-only, and we did not know that when we filed

Running the same probe on **Polkadot Desktop 0.1.1** (Electron 42.4.0, Chrome
148) the submit **works**:

```
[YES] preimage submit          key 0x4d2f82f9…31658 in 64332ms
[YES] preimage lookup of what we just submitted   37 bytes back, identical: true
```

So the discriminant error is not the surface being broken everywhere; it is a
skew between one host build and the client. #13 was filed from Android and is
accurate there, but the sentence in it that generalises — that no app on this
devnet can accept a file from anybody — is **wrong on desktop**, and we published
it. Corrected here and in [#13](https://github.com/Polkadot-Community-Foundation/products-devnet-issues/issues/13).

Worth its own note: **64 seconds** for a 37-byte round trip. It returns, and no
interface can present a minute of silence as anything but broken.

### Reproduce

chirp → Settings → Diagnostics → Run the probe. Or directly:

```ts
const mgr = await getPreimageManager();
await mgr.submit(new TextEncoder().encode('hello'));   // throws
```

### Ask

Either the host's response for this method or the client's codec is ahead of the
other; aligning them fixes it. Failing that, surfacing the raw frame in the
error would let an app tell a user something better than "unknown discriminant".

### What we did instead

Moved profile pictures into contract storage on Asset Hub — the bytes
themselves, capped at 12 KB, paid for as a storage deposit by whoever sets one.
It cannot expire and cannot fail to resolve, but it is not a general answer:
nobody should store a photograph in contract storage, and nothing larger fits.

---

# Issue 2 — an ordinary account has no Bulletin storage authorisation at all

This is #9, restated in the chain's own terms rather than as a series of
failures. `checkAuthorization` reads `TransactionStorage.Authorizations`
directly:

```
[NO] Bulletin storage authorisation for 5H3ooRY1pX…
     {"authorized":false,"remainingTransactions":0,"remainingBytes":"0","expiration":0}
```

Not "expired", not "quota exhausted" — **no entry**. Zero transactions, zero
bytes, no expiry, for a normal account in good standing on the devnet.

Confirmed a second time on **Polkadot Desktop 0.1.1**, a different account
(`5Exa9Am2Qd…`), same answer: `authorized:false`, zero of everything. So it is
not one account's bad luck and not one platform.

The allocation route we added at startup on the strength of the SDK's types has
its answer too, and it is no:

```
[NO] allocation BulletinAllowance   {"ok":true,"value":["NotAvailable"]}
[NO] allocation AutoSigning         {"ok":true,"value":["NotAvailable"]}
```

`NotAvailable` rather than a refusal: there is nothing to grant on this host.

### Why this is worth a number

Everything said about Bulletin authorisation so far, ours included, has been
argued from things that failed: a publish that drew an unauthorised pool
account, an upload that never came back. That is easy to dismiss as an app
holding it wrong. This is the chain being asked directly and answering nothing.

### Consequences, taken together with Issue 1

Bulletin is the platform's storage story, and today a user can reach it by
exactly two routes: the storage pool, which needs an authorisation they cannot
get, and the host's preimage surface, which currently throws. Both are shut. An
app that wants to hold anything bigger than contract storage allows has nowhere
to put it.

### Ask

Whatever grants authorisation to publishers should be reachable for user
accounts too, or the preimage path should be fixed — either one reopens the
door. Both would be better.

---

# Two documentation gaps that each cost a day

Not bugs. Both were found by reading generated types, which is not where anyone
should have to look.

### `PreimageSubmit` is a separate permission from `ChainSubmit`

```ts
{ tag: 'ChainSubmit',    value: undefined }
{ tag: 'PreimageSubmit', value: undefined }
```

Without the second, `submit()` cannot work — and its absence produces silence,
not an error. Exactly the same trap as `ChainSubmit`, which the docs do mention.
One line beside `getPreimageManager` would do it.

### The per-extrinsic weight ceiling

Writing a few kilobytes into contract storage fails with `Revive.OutOfGas`, and
the fix is to raise `gasLimit`. The trap is that raising it too far fails
differently and more confusingly, because a call may not ask for more than a
single extrinsic's share. From this chain:

```
System.BlockWeights
  max_block             ref_time 2_000_000_000_000   proof_size 10_485_760
  normal max_extrinsic  ref_time 1_599_875_000_000   proof_size  8_388_608
```

Our first correction asked for `8_000_000_000_000` — four times a whole block —
which would have been refused before executing. Stating the ceiling next to
whatever documents `gasLimit` would save the next person the same detour.

---

# Issue 3 — `navigateTo` returns `ok` for an external URL and opens nothing

**Symptom.** Tapping any external link in an app inside the Polkadot app does
nothing at all. No browser, no error, no visible change.

**What the app sees.** `navigateTo(url)` resolves, promptly, with `ok: true`.
Nothing else happens: no browser appears, and the app's own document never goes
to the background — `visibilitychange` does not fire and `document.visibilityState`
stays `visible` for as long as you care to wait.

The trail below is printed by the app itself, from a phone, on a real tap:

```
popup:skipped-in-app>host:ok>host:said-ok-but-nothing-opened
```

Read left to right: the popup route was skipped because we are in the app, the
host accepted the address and answered ok, and 1.4 s later this screen had never
been backgrounded.

**Ruled out on our side, in this order:**

- **Popups.** `window.open` inside the app returns a `Window` object, that object
  is **not** `closed` a moment later, and nothing is displayed. The handle carries
  no information here, so neither `null` nor `.closed` can be used to detect
  failure. (On the dot.li gateway the same call works — the frame carries
  `sandbox="… allow-popups"`. Evidence from the gateway does not transfer to the
  app; they are different hosts.)
- **The `OpenUrl` device permission**, requested at startup, granted.
- **The URL scheme.** First seen with `http://`, on the theory that a host might
  hand only `https` to a browser. Retested with `https://`: **identical**.

**Why it matters more than it looks.** An `ok` that means "request accepted"
rather than "a browser opened" is indistinguishable, from inside, from success.
Every app in this workspace reported opening links it had not opened, for weeks,
because there is nothing else to check. The only reason we know now is that the
app was instrumented to cross-check the host's answer against whether its own
page ever lost visibility.

**Ask:** either open the URL, or return an error. If neither is possible on a
given host, a documented way to ask "can you actually open links?" would let an
app show the address up front instead of offering a control that cannot work.

**What the app does meanwhile.** Shows the address, copyable, with the trail
attached — because a tap that silently does nothing is the worst outcome
available, and the second worst is telling somebody it worked.

---

# Issue 4 — the light client panics while fetching an app bundle

**Severity: it is the first thing anyone sees of a published app.**

Opening a published `.dot` app with the content source set to **Verified**
sometimes never gets the bundle. The screen says "Failed to load content":

```
bitswap_v1_get failed (code=-32603): panicked at wasm-node/rust/src/platform.rs:1035:37:
called `Option::unwrap()` on a `None` value
(via smoldot-bitswap)
```

Three things about that line matter more than the failure:

- **It is a panic, not a fetch error.** `-32603` is JSON-RPC *internal error* —
  the light client's platform layer unwound and the message reached the UI
  through the RPC boundary. Content that genuinely cannot be found should not
  look like this.
- **It is intermittent.** Same app, same CID, same device: retry and it usually
  loads. That is a race, not bad content.
- **No app code has run yet.** Nothing a publisher can do, and nothing to catch.

What we could not confirm: which smoldot version the app ships, so which
`unwrap()` line 1035 is. In current `smol-dot/smoldot` HEAD the unwraps in that
region are map lookups made when the JavaScript side reports a connection or
stream event — consistent with an event arriving for a connection already torn
down. That is a reading of the source, not a diagnosis.

**Workaround:** Retry, or switch the panel from Verified to **Trusted**, which
does not take the bitswap path at all.

**Ask:** a missing entry in that map is a connection that went away, which is an
ordinary thing for a connection to do. Failing the fetch cleanly so the layer
above can retry turns this from a dead end into a hiccup nobody notices.

---

# One thing that is not a bug and cost a week anyway

An app is served from its content hash, so **publishing a new build changes the
origin and `localStorage` starts empty**. Every preference an app keeps the
ordinary way is wiped by its own next release. Nothing errors; people find their
settings reset and assume they did it themselves.

`getHostLocalStorage()` is the right home and it works — the probe confirms a
write-then-read round trip is exact. But nothing points a developer at it, and
the obvious API is the one that quietly loses data.

**Ask:** a line saying `localStorage` does not survive a release, and that host
storage does.

---

Happy to test any fix against a real app. The probe is in chirp under Settings →
Diagnostics, and it prints a report like the ones above.
