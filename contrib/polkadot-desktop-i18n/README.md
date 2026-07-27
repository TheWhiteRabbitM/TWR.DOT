# Italian locale (`it.json`) for Polkadot Desktop

A complete Italian translation of the app's message catalogue, ready to drop into
`src/shared/translation/locales/`.

- **683 strings**, identical key structure and key order to `en.json`.
- No added keys, no omitted keys, no reordering.
- All ICU placeholders and the one plural form preserved and verified.

---

## Provenance

Translated from the upstream English catalogue:

| | |
|---|---|
| Repository | `Polkadot-Community-Foundation/polkadot-desktop-community` |
| Source file | `src/shared/translation/locales/en.json` |
| **git blob SHA of `en.json`** | **`620cc265c7e22bbb6c0fba42f396a7c6d4aea6e0`** |
| Size / strings | 39 727 bytes, 683 leaf strings |
| Last commit touching `en.json` | `84839c28e6352b89305709235784b4fe864c9f3b` — *"sync: update to w3s (#7)"*, 2026-06-17 |
| Repo HEAD when translated | `aeac9a6ae98a98603c8cc737a8e8d22ae4277b4d` — *"docs(release): fuller macOS Gatekeeper install guide in release notes"*, 2026-07-23 |
| Translated | 2026-07-27 |

To confirm the source has not moved since:

```bash
gh api repos/Polkadot-Community-Foundation/polkadot-desktop-community/contents/src/shared/translation/locales/en.json --jq .sha
# expect 620cc265c7e22bbb6c0fba42f396a7c6d4aea6e0
```

If that SHA differs, re-run the verification script below to see exactly which keys drifted.

---

## Installing

```
cp it.json src/shared/translation/locales/it.json
```

That is the whole change. Nothing else needs to be edited:

- `Locale` is `export type Locale = string` (`src/shared/translation/types.ts`), so there is no
  union to extend.
- `TranslationProvider` loads locales with `import('./locales/${locale}.json')` and falls back to
  `en.json` on any failure, so an unknown locale can never hard-fail the app.
- `flattenMessages` turns the nested object into the dot-notation ids that `useTranslation()`'s
  `t('feature.browser.newTab')` looks up. Because the key structure is identical, every existing
  call site resolves.

### Making it reachable

The provider accepts a `locale` prop but is currently mounted **without** one
(`src/index.tsx:144` — `<TranslationProvider>`), so the app always renders English today. Adding
this file makes Italian *available*; surfacing it still needs either a language setting or
`locale={navigator.language.split('-')[0]}` passed to the provider. That wiring is deliberately
out of scope for this contribution — it is a product decision, not a translation one.

To eyeball it before wiring anything up, temporarily set `const DEFAULT_LOCALE = 'it'` and pass
`locale="it"` in `src/index.tsx`.

### Bundler note (checked, not assumed)

The dynamic `import()` returns a module namespace, so `flattenMessages` sees both the named
exports (`common`, `feature`, `widget`) and `default`. That yields 683 correct ids plus 683
redundant `default.*` ids, which are harmless — the correct ones resolve.

This is worth stating explicitly because Vite's `json.stringify: 'auto'` default disables named
exports for large JSON files, which *would* have broken the loader. I built a fixture against the
repo's actual Vite version (8.0.16) with this exact 42 kB file and confirmed the emitted chunk
still ends in `export { common, it_default as default, feature, widget }`, and that flattening the
namespace produces all 683 working ids. No config change is required.

---

## Verification

Run from the repo root with `it.json` in place:

```js
// node verify-locale.mjs
import en from './src/shared/translation/locales/en.json' with { type: 'json' };
import it from './src/shared/translation/locales/it.json' with { type: 'json' };

const flat = (o, p = '', acc = new Map()) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, acc);
    else acc.set(key, v);
  }
  return acc;
};
const E = flat(en), I = flat(it);
const names = s => [...String(s).matchAll(/\{\s*([A-Za-z0-9_]+)\s*(?:,|\})/g)].map(m => m[1]).sort();

const missing = [...E.keys()].filter(k => !I.has(k));
const extra = [...I.keys()].filter(k => !E.has(k));
const badPlaceholders = [...E.keys()].filter(
  k => I.has(k) && JSON.stringify(names(E.get(k))) !== JSON.stringify(names(I.get(k))),
);

console.log({ en: E.size, it: I.size, missing, extra, badPlaceholders });
```

Result at the time of writing:

```
en: 683   it: 683
missing: []      extra: []      badPlaceholders: []
key order identical: true
```

Additionally checked with `intl-messageformat@11.2.7`, the exact version pinned in the repo's
`package-lock.json` under `react-intl@10.1.11`:

- All 683 Italian messages parse as ICU with locale `it` — **0 failures**.
- All 683 format successfully with dummy arguments — **0 failures**.
- The single plural message renders correctly against Italian CLDR rules:
  `0 → "Nessuna app"`, `1 → "1 app"`, `2 → "2 app"`, `5 → "5 app"`.
- File is UTF-8, no BOM.

Nothing was silently patched by copying English. The 39 strings that are byte-identical to the
English are listed and justified at the end of this file.

---

## Register and style

Two rules, applied consistently:

1. **Interactive controls** (buttons, menu items, action `aria-label`s) use the bare imperative,
   which is the universal Italian software convention: *Annulla, Conferma, Firma, Consenti,
   Riprova, Ricarica, Installa*.
2. **Everything else** (descriptions, hints, errors, permission rules) is **impersonal**: infinitive
   for instructions (*"Verificare la connessione a Internet e riprovare"*), `si`-passive or third
   person for statements (*"I dati non vengono memorizzati né trasmessi senza autorizzazione"*).
   No `tu`/`Lei` pronouns, and English possessive `your` is dropped wherever Italian does not need
   it — *"No access to your private keys"* → *"Nessun accesso alle chiavi private"*.

A useful side effect of rule 2: the permission `description` strings all start with **"Serve per…"**
instead of *"Utilizzato/a/i/e per…"*. `Serve` is invariant, so the sentence stays grammatical
regardless of the gender and number of the permission it describes (*Fotocamera* f., *Microfono* m.,
*Notifiche* f.pl., *Appunti* m.pl.). This avoids a whole class of agreement bugs that a
key-by-key literal translation would have introduced.

### UI space

Italian runs **+16.3 % longer** overall (17 238 → 20 051 characters), inside the expected band.
Growth is concentrated in prose (error bodies, permission rules, dialog descriptions) rather than in
controls. Where a faithful rendering would have been much longer than the English, a shorter
idiomatic equivalent was chosen instead:

| Key | English | Italian | Note |
|---|---|---|---|
| `feature.browser.havingTroubleSigningDialog.troubleshootingGuide` | Troubleshooting Guide | Guida alla risoluzione | full form *"…dei problemi"* would overflow the button |
| `feature.dashboard.widgetMenu.cleanup` | Cleanup Dashboard | Riordina Dashboard | *"Pulisci"* reads as "delete"; *"Riordina"* is what the action does |
| `common.action.moreDetails` | More details | Altri dettagli | *"Più dettagli"* is a calque |
| `feature.updateCheck.checking` | Checking for updates… | Verifica in corso… | the noun is already in the section title |
| `feature.chat.viewMore` | View More | Mostra altro | shorter and idiomatic for "show more" |
| `feature.productSettings.subtitle` | Apps you've interacted with | App già utilizzate | literal *"App con cui si è interagito"* is stiff and long |
| `feature.dashboard.addWidget.toast.viewAction` | View | Vedi | toast action button, must stay ~4 chars |

The longest relative growth on short strings lands on `aria-label`s (`findNext`, `findClose`) and
status text, none of which are width-constrained controls.

---

## Glossary

Applied uniformly across all 683 strings.

### Kept in English (terms of art / loanwords already standard in Italian)

| Term | Reasoning |
|---|---|
| **account** | Italian tech standard. *"Conto"* means a bank account and would mislead here. |
| **chain** | The Italian Polkadot/Substrate community says *chain*, *parachain*, *relay chain*; *"catena"* is never used for this. Used in *chain personalizzate*, *chain Substrate*, *Bulletin chain*, and the `common.label.chain` label. Note this is kept **distinct** from `network` → **rete**, exactly as the English distinguishes them. |
| **widget, dashboard, app, alias, token, live, online, offline, RPC, WebRTC, Bluetooth** | Universally used untranslated in Italian software. Plural is invariant: *i widget*, *le app*. |
| **preimage** | Polkadot governance term of art; translating it would make on-chain concepts unrecognisable. → *Invio di preimage*. |
| **statement** / **statement store** | Names a specific Substrate pallet and its store. Kept, as *"dichiarazione"* would sever the link to the concept. → *Invio di statement*, *statement store*. |
| **allowance** | `allocationRequest.title`, `allocationRejected`, and `browser.noAllowanceError*` all name the same on-chain allowance concept, which Italian crypto usage keeps in English (as with ERC-20 allowance). *"Autorizzazione"* would have collided with `permission`, and *"delega"* would have collided with governance delegation. → *Richiesta di allowance*. Flagged below as a borderline call. |
| **call data** | Substrate signing term of art, shown next to the raw SCALE-encoded payload. *Arguments* however is genuinely generic → **Argomenti**. |
| **Utility Batch All / Utility Batch / Utility Force Batch** | These are `utility.batchAll` / `utility.batch` / `utility.forceBatch` runtime calls rendered for humans. Translating them would break the correspondence with the call the user is actually signing. The explanatory `batchBehavior.*` hints beneath them *are* translated. |
| **build** (`updateCheck.channel.*Hint`) | *"Build"* is standard in Italian dev-facing copy; *"compilazioni"* is not. |
| **push, storage, cache, log, download, host, smart contract, testnet, endpoint, node → nodo** | Standard Italian technical register. |

### Translated

| English | Italian | Note |
|---|---|---|
| sign / signing / signer | **firmare** / **Firma in corso** / **Firmatario** | Cryptographic signature throughout — never *"segno"*/*"insegna"*. Button `common.action.sign` → **Firma**. |
| transaction | **transazione** | |
| network / network fee | **rete** / **commissione di rete** | *"Commissione"*, not *"tassa"* or *"fee"* — this is what Italian exchanges and wallets use. |
| permission | **autorizzazione** | Matches Android/iOS Italian. Kept clear of *allowance* (see above). |
| address | **indirizzo** | |
| back | **Indietro** | Navigation, not a road sign. `navigationBackAria` → *Torna indietro*. |
| tab | **scheda** | Standard Italian browser terminology. |
| clipboard | **Appunti** | |
| camera | **Fotocamera** | |
| location | **Posizione** | |
| biometrics | **Biometria** | |
| files | **File** | Invariant plural. |
| web domains | **Domini web** | |
| clear cache | **Svuota cache** | *"Cancella"* is reserved for clearing lists (`clearRecent`, `chat.clear`). |
| forget app | **Dimentica app** | |
| favorites | **Preferiti** | |
| pairing / paired | **abbinamento** / **abbinato** | The standard Italian term for device pairing. |
| log in / log out | **Accedi** / **Esci** | |
| allow once / always allow / don't allow | **Consenti una volta** / **Consenti sempre** / **Non consentire** | Matches Apple's Italian permission strings, so users see wording they already know. |
| ask (default) / allowed / denied | **Chiedi (predefinito)** / **Consentito** / **Negato** | |
| rules & safeguards | **Regole e tutele** | |
| on-chain actions | **Azioni on-chain** | Hybrid, but *"azioni sulla catena"* is not how anyone says it. |
| chain submit | **Invio su chain** | |
| dismiss | **Ignora** | |
| reload | **Ricarica** | |
| retry | **Riprova** | |
| undo | **Annulla** | Shares a word with *cancel*, but the two never appear together (toast vs. dialog). |

### Deliberately not literal

- `feature.chat.transfer.youSent` "You Sent" and `.sent` "Sent" both → **Inviato**. Italian has no
  natural short second-person past participle here, the bubble already shows direction visually,
  and the impersonal form avoids gender agreement. `received` → **Ricevuto**.
- `feature.chat.replyToYourself` "Reply to yourself" → **Rispondi al tuo messaggio**. The direct
  rendering *"Rispondi a te stesso"* is gendered (*stesso/stessa*); this phrasing is neutral, the
  same length, and parallel to `replyTo` → *Rispondi a {name}*.
- `feature.browser.signingRequestTitle` "{call} signing request" → **Richiesta di firma: {call}**.
  The placeholder holds an English call name (*Utility Batch All*, *Balances Transfer Keep Alive*);
  putting it after a colon keeps the Italian grammatical regardless of what lands there.
  Same treatment for `signMessageRequestTitle`.
- `widget.rateLimiter.description` "{limiterType} limit is reached" → **Limite {limiterType}
  raggiunto**, which reads correctly with every one of the 15 `types.*` values that can fill it.
- `feature.dashboard.addWidget.toast.widgetAddedProduct` → **Il widget {widgetTitle} {sizeLabel}
  è stato aggiunto alla Dashboard**. The call site lowercases `sizeLabel`, and *widget* is
  masculine in Italian, so the size adjectives (*piccolo, medio, grande, orizzontale*) agree.
- `feature.productSettings.appPermission.title` "{productName} {permission} Access" →
  **Accesso a {permission} per {productName}**. Placeholders reordered because Italian cannot
  stack noun modifiers; both are still present.
- `feature.permissionSettings.appCount` → `{count, plural, =0 {Nessuna app} one {# app}
  other {# app}}`. Italian CLDR has `one` and `other`; *app* is invariant, so both arms read
  "app" — this is correct, not a copy-paste slip.

---

## Strings I could not fully disambiguate

Three, all flagged rather than guessed:

1. **`feature.settings.endpointStable` and `feature.statementStoreNetwork.options.endpointStable`
   ("Stable") — left as `Stable`.** Both keys are unreferenced in the current source. The endpoint
   picker that would use them (`TestnetSettings.tsx`) renders environment names straight from
   `environmentService.list()`, i.e. from config, not from the catalogue. Translating to *"Stabile"*
   would show a translated label next to untranslated config-sourced siblings. If these keys are
   ever wired up and *Stable* is an adjective rather than an environment name, change to
   **Stabile** — which is what the unrelated `updateCheck.channel.stable` (a genuine adjective)
   already uses.
2. **`widget.productContainerBinding.allocationRequest.title` ("Allowance request") →
   *Richiesta di allowance*.** Borderline. The alternative *"Richiesta di deleghe"* is more
   transparent and arguably better Italian — the listed resources are literally *"Sign transactions
   automatically"*, i.e. delegations. I kept *allowance* to stay consistent with
   `feature.browser.noAllowanceError*`, which names the same on-chain object, and to avoid
   colliding with governance *delega*. Happy to switch if maintainers prefer.
3. **`feature.signingBotAutopair.title` ("Signing Bot") → *Bot di firma*.** Translated on the
   assumption it is descriptive, not a product name. It is a dev-only pairing helper
   (the whole feature is gated out of production builds), so the risk is low — but if "Signing Bot"
   is the service's actual name, revert to the English.

Also worth knowing: `feature.ticketApp.*`, `feature.shopping.*`, `feature.hackm3.*`,
`common.action.{all,electronics,fashion,forward,select,delete,add,search,disconnect}` and
`common.label.{signer,chain,method}` have no call sites in the current tree. They are translated
anyway (the brief is a complete catalogue), but they could not be checked against live UI, so their
context is inferred from the surrounding keys. `Mark3t`, `Hackm3` and `Ticket App` are treated as
product names and kept.

---

## The 39 strings identical to English

Every one is intentional; none is an untranslated leftover.

- **Format-only / symbols:** `feature.browser.suggestionSeparator` (`—`), `feature.browser.feeUnavailable` (`—`), `feature.browser.findCount` (`{current}/{total}`), `feature.browser.zoomPercent` and `feature.updateCheck.downloadingPercent` (`{percent}%`), `feature.permissionSettings.categoryHeading` (`{name}:`), `feature.permissionSettings.detail.appSubtitle` (`{baseName} • {allowed}`), `feature.customChains.addedToastDescription` (`{name} ({genesisHash})`), `feature.customChains.endpointPlaceholder` (`ws://localhost:9944`).
- **Same word in both languages:** `feature.browser.account`, `feature.userManager.aria.account`, `feature.chat.title` (Chat), `feature.dashboard.title` (Dashboard), `widget.permission.modality.app.label` (App), `feature.productSettings.aliasPermission.label` and `widget.rateLimiter.types.alias` (Alias), `feature.signingBotAutopair.tokenLabel` (Token), `common.status.online`, `common.status.live`, `feature.hackm3.live`, `feature.hackm3.online` (`{count} online`), `feature.shopping.category` (SHOPPING).
- **Technical terms of art:** `common.label.chain`, `common.label.callData`, `widget.rateLimiter.types.rpc` (RPC), `widget.rateLimiter.types.preimage`, `*.permission.Bluetooth`, `*.permission.WebRtc` / `WebRtc.label` (WebRTC), the three `feature.browser.operationTitle.*` runtime call names.
- **Proper names:** `feature.ticketApp.title`, `feature.shopping.title` (Mark3t), `feature.hackm3.title`, `feature.chat.transfer.coinage.currencyLabel` (CASH), `feature.settings.endpointStable` and `feature.statementStoreNetwork.options.endpointStable` (see caveat 1 above).

---

## Licence

Contributed under the repository's existing licence.
