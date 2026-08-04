# Issues for the products devnet — drafts, and what still has to be measured

Written after building **chirponchain.dot**, a text-only social app that keeps
everything in Asset Hub contracts.

## Why this file is not just three bug reports

A first draft of this reported three container limits: a file chooser that never
opens, remote images blocked despite a granted permission, and `navigateTo`
neither opening nor answering. It was going to be filed. It should not have
been, and the reason is worth stating because it is the whole method here.

Every one of those was a **symptom we had explained to ourselves**, and two of
them turned out to have causes on our side:

- The picture upload that "proved" the file chooser was broken was failing
  because we stored a 66-byte hex STRING in a field that accepts 64 bytes, and
  then, once that was fixed, because our gas figures were sized for writing a
  single word rather than kilobytes.
- The image that "proved" `Remote` does not cover `img-src` was never checked
  against the permission's actual answer. We requested it and never looked at
  whether it was granted.
- `navigateTo` "hanging" was measured by a person watching a screen, not by
  looking at the returned promise.

A bug report built on a guess costs the time of the one person who could have
fixed the real thing. So each claim below now has a test that produces evidence
a stranger can check, the tests ship inside the app at `#/probe`, and **nothing
gets filed until the probe has been run inside the Polkadot app and its output
pasted in**.

The probe is deliberately part of chirp rather than a separate page: these
questions only have answers inside a container, and a page that has to be
published to be run is a page nobody runs.

---

# What can be stated today, with evidence

These do not need the probe. They are facts about the chain and the SDK that we
checked directly, and they are the ones that cost us the most time.

## A. `PreimageSubmit` is a separate permission from `ChainSubmit`, and nothing says so

`RemotePermission` has four variants, two of which govern writes:

```ts
{ tag: 'ChainSubmit',    value: undefined }   // submitting transactions
{ tag: 'PreimageSubmit', value: undefined }   // submitting preimages
```

Without the second, `getPreimageManager().submit()` cannot work. It is the exact
twin of the `ChainSubmit` trap — a missing permission that produces silence
rather than an error — and we found it only by reading the generated types.

**Ask:** one line in the docs beside `getPreimageManager`.

## B. The weight ceiling is not where a contract app would guess

Writing a few kilobytes into contract storage failed with `Revive.OutOfGas`. The
fix is to raise `gasLimit`, and the trap is that raising it too far fails
differently and more confusingly. Read from this chain:

```
System.BlockWeights
  max_block             ref_time 2_000_000_000_000   proof_size 10_485_760
  normal max_extrinsic  ref_time 1_599_875_000_000   proof_size  8_388_608
```

So a single call can use at most ~1.6e12 of `ref_time`. Our first correction
asked for 8e12 — four times a whole block — which would have been refused before
executing.

**Ask:** state the per-extrinsic ceiling in the contracts documentation, next to
whatever explains `gasLimit`. Anyone sizing a limit by trial will otherwise walk
straight past it.

## C. `Revive.ContractTrapped` when registering a new contract name

`cdm deploy` traps while REGISTERING any name the ContractRegistry has not seen.
Proven with a two-line contract and with the registry address passed explicitly;
redeploying an already-registered name works. The instantiate itself is fine, so
the workaround is a bare `Revive.instantiate_with_code`.

This is already filed as #10 — repeated here only because it is the same class:
a failure whose message names the wrong step.

---

# What needs the probe before it is filed

Each of these has a test. The template is written; the evidence block is empty
until someone runs `#/probe` inside the Polkadot app and pastes the output.

## 1. Does a file input open a chooser?

**Test.** `#/probe` renders a real `<input type="file">` and reports the file it
receives. The element being accepted by the webview is checked separately, since
that is a different question from whether tapping it does anything.

**Evidence:** _(paste the probe line for "file input", plus what happened when
you tapped the real one)_

**If it does not open**, the ask is one of, in order of preference: implement the
WebView file chooser; add an SDK `pickImage()`; or make the input throw or log,
so an app can offer its fallback immediately instead of shipping a dead button.

**Our workaround either way:** a `contenteditable` paste target reading
`clipboardData.items`.

## 2. Does the `Remote` permission cover `img-src`?

**Test.** `#/probe` requests `Remote` for two hosts and **prints the answer**,
then fetches the same URL and loads it in an `<img>`, back to back. The claim is
only meaningful if the permission was granted; the first draft of this issue
never established that.

**Evidence:** _(paste the three lines: Remote permission, fetch, `<img>`)_

**If fetch succeeds and `<img>` does not**, the ask is either to extend `Remote`
to `img-src` for the declared domains, or to document that it does not — a
granted permission that appears to have had no effect reads as a bug.

**Our workaround:** fetch the bytes and wrap them in a blob URL, which is
same-origin and therefore unaffected.

## 3. Does `navigateTo` settle?

**Test.** `#/probe` calls it and races the promise against six seconds, printing
whether it settled and with what.

**Evidence:** _(paste the `navigateTo` line)_

**If it does not settle**, the ask is small: settle it. `PermissionDenied` is a
perfectly good answer and lets an app fall back at once. A promise that never
resolves cannot be handled at all.

**Our workaround:** race it, then try `window.open`, then put the address on the
clipboard and tell the person the container will not open links.

## 4. Is a submitted preimage retrievable?

**Test.** `#/probe` submits unique bytes and then looks up the key it was given,
waiting fifteen seconds, and compares byte for byte.

**Evidence:** _(paste the three preimage lines)_

This one matters more than it looks. `getPreimageManager` is the only upload
path an ordinary user has — the Bulletin storage pool accounts need an
authorisation users cannot obtain (#9) — so if the round trip does not hold, no
app on this devnet can accept a picture from anybody.

**What we did instead:** moved profile pictures into contract storage. It costs
the user a deposit and caps the image at 12 KB, but it cannot expire and cannot
fail to resolve.

---

# One thing that is not a bug, and cost a week anyway

An app is served from its content hash, so **publishing a new build changes the
origin, and `localStorage` starts empty**. Every preference an app keeps the
ordinary way is silently wiped by its own next release. Nothing errors; people
simply find their settings reset.

`getHostLocalStorage()` is the right home — it belongs to the host and outlives
both the origin and a cache clear — but nothing points a developer at it, and
the obvious API is the one that quietly loses data.

**Ask:** a line in the docs saying that `localStorage` does not survive a
release, and that host storage does.
