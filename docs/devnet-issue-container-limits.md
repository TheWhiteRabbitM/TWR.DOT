# Three container limits that make an app look broken rather than restricted

Filed from building **chirponchain.dot**, a text-only social app that runs
entirely on Asset Hub contracts. Everything below was measured inside the
Polkadot app against the products devnet, and each one cost a day or more
because the failure mode is *silence* — the API returns, nothing happens, and
there is nothing in the console to go on.

None of these is a request for a new capability. Two are already-supported
things failing quietly; the third is a documentation gap that sends every app
down the same dead end.

---

## 1. `<input type="file">` never opens a chooser

**What happens.** A file input in the container does nothing when tapped. No
picker, no error, no `change` event. Both forms behave the same:

```html
<!-- hidden, opened programmatically — the common pattern -->
<input type="file" id="f" accept="image/*" hidden>
<button onclick="document.getElementById('f').click()">Choose</button>

<!-- a plain, visible input -->
<input type="file" accept="image/*">
```

**Why it matters.** A profile picture, an avatar, any user-supplied image. There
is no alternative surface: the SDK has no picker, and `getPreimageManager()`
only helps once you already hold the bytes.

**What we did instead.** A `contenteditable` paste target and a `paste` handler
reading `clipboardData.items`. It works, but it is not a control anyone expects
to find, and on a phone "copy the image first" is a strange instruction.

**What would help, in order of preference.** Implementing the WebView file
chooser (`onShowFileChooser` on Android, the equivalent delegate on iOS); or an
SDK `pickImage()` returning bytes; or — cheapest — having the input **throw or
log** so an app can offer the fallback immediately instead of shipping a dead
button.

---

## 2. Remote images are blocked before any permission is consulted

**What happens.** `<img src="https://media.tenor.com/…">` does not render, even
with the domain declared:

```ts
await requestPermission({ tag: 'Remote', value: { domains: ['media.tenor.com'] } });
```

`fetch()` to the same host *is* governed by that permission and works when
granted. So the two are on different policies, and `Remote` appears to cover
fetch/XHR/WS but not `img-src`.

**Why it matters.** GIFs from a phone keyboard arrive as links to exactly these
hosts. Rendering the link costs nothing on chain and nothing on Bulletin, which
is the correct design — and it is the one that is blocked.

**What we did instead.** `fetch` the bytes, wrap them in a blob URL, point the
tag at that. Same origin, nothing blocked. Where CORS is refused we fall back to
an `<img>` attempt and then to a chip that opens the link externally.

**What would help.** Either have `Remote` extend to `img-src` for the declared
domains, or document plainly that it does not — the current behaviour reads as a
bug because a granted permission appears to have had no effect.

---

## 3. `navigateTo` sometimes neither opens nor answers

**What happens.** `navigateTo('https://…')` returns a promise that never settles.
Not a `PermissionDenied`, not an error — nothing. Ordinary anchors are also inert
in the container (no second window), so a link becomes a tap that does nothing.

**What we did instead.** Race it at three seconds, then try `window.open`, then
put the address on the clipboard and *tell the person* the app cannot open links
and show them the URL.

**What would help.** Settling the promise — `PermissionDenied` is a perfectly
good answer and lets an app fall back immediately.

---

## Two things worth writing down for other builders

Neither is a bug, and both cost us a day.

**`PreimageSubmit` exists and is separate from `ChainSubmit`.** Without it,
`getPreimageManager().submit()` cannot work. It is the exact twin of the
`ChainSubmit` trap — a permission whose absence produces silence rather than an
error — and it is not mentioned anywhere we could find.

**`getPreimageManager` is the only upload path an ordinary user has.** The
Bulletin storage-pool accounts a publisher draws from need an authorisation
users cannot obtain (see #9), so this is not one option among several. Worth
saying in the docs, because the obvious reading is that Bulletin is generally
writable by apps.

And a caution for anyone reaching for it: Bulletin retention is roughly a
fortnight, so anything stored there needs re-submitting. We moved profile
pictures off it and into contract storage for that reason — a picture that
disappears after two weeks, or when a browser cache is cleared, was never really
stored.

---

Happy to test any fix against a real app; chirp exercises all three paths on
every launch.
