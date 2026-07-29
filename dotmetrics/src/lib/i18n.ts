import { useSyncExternalStore } from 'react';

/**
 * Four languages, no library.
 *
 * The bundle is already ~1.4MB; i18next and its plugins would add tens of
 * kilobytes to carry a few kilobytes of prose. So: one dictionary, one `t()`,
 * one subscription so React re-renders when the language flips.
 *
 * The type discipline is the whole point. `EN` is the source of truth and its
 * keys become {@link MsgKey}; every other language is declared
 * `Record<MsgKey, string>`, so a forgotten translation is a compile error at
 * `npm run build` and never a blank label at runtime. An *extra* key fails too
 * — excess property checking catches the key that was renamed on one side only.
 * {@link DICT} is `Record<Lang, …>`, so adding a code to {@link LANGS} without
 * adding its dictionary is the same compile error.
 *
 * NOTHING IS PARAMETERISED BY LANGUAGE except through this file. A string that
 * has to name a language — an aria-label on the language control, the banner
 * over a machine translation — takes `{language}` and fills it from
 * {@link languageName}, so four languages cost one key and not four.
 *
 * WHAT IS NOT IN HERE, deliberately: the descriptions third-party app authors
 * publish in their on-chain manifests. Those are their words, in their
 * language, and this app does not own them — see lib/detect-lang.ts and
 * lib/translate.ts for how they are marked and, only on request, translated.
 */

export const LANGS = ['en', 'it', 'es', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * The name of each language IN ITSELF, for the language control only.
 *
 * A reader who has landed in a language they cannot read needs to find their
 * own in the list; "Spagnolo" does not help them, "Español" does. Everywhere
 * else — the translation banner, the detected-language marker — a language is
 * named in the READER's language, via {@link languageName}.
 */
export const ENDONYM: Record<Lang, string> = {
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  fr: 'Français',
};

/* ------------------------------------------------------------ dictionary */

const EN = {
  /* --- top bar ------------------------------------------------------- */
  'bar.devnet': 'devnet',
  'lang.aria': 'Interface language',
  /* One key, not one per language: `{language}` comes from `languageName()`,
     so a fifth language costs a dictionary and nothing else. */
  'lang.trigger.aria': 'Interface language: {language}. Choose another.',
  'lang.switch.aria': 'Switch the interface to {language}',

  /* --- search -------------------------------------------------------- */
  'search.placeholder': 'Search {n} .dot apps by name or description',
  'search.aria': 'Search every indexed .dot name, display name and description',
  'search.clear': 'Clear search',

  /* --- headline pair ------------------------------------------------- */
  'hero.line':
    'apps indexed · {published} published · {deployed} deployed · {declared} declaring a contract · {updated}',
  'hero.updated': 'updated {ago}',
  'hero.rpcDown': 'rpc unreachable',
  /**
   * Shown when reads fell back off the first-choice endpoint onto a spare. The
   * numbers are there because a reader who can see "2 of 3" can also see that
   * there is a third left; "degraded" alone would say neither how bad it is nor
   * that the figures on the page are still real.
   */
  'hero.rpcFallback': 'first rpc down · reading through {host}, endpoint {using} of {total}',
  'reg.title': 'Registrations',
  'reg.note': 'one cell per UTC hour · one row per UTC day · day total in the right gutter',
  'reg.legend': 'names registered',

  /* --- facets -------------------------------------------------------- */
  'facets.aria': 'Filter the index by what exists on chain',
  'facet.all': 'All',
  'facet.published': 'Published',
  'facet.deployed': 'Deployed',
  'facet.name': 'Name only',
  /* Replaces "Live data", which counted the four apps whose contract ABI we had
     hard-coded — i.e. the index operator's own. This one counts a record any
     name can publish. */
  'facet.declared': 'Declares a contract',
  'facet.new': 'New today',
  /* Rendered ONLY when its count is above zero: alive is the normal state of a
     deployed bundle, and a permanent "Unreachable 0" chip would dignify the
     exception into a category. */
  'facet.unreachable': 'Unreachable',

  /* --- the index ----------------------------------------------------- */
  'idx.count.search':
    '{shown} of {all} names match “{q}” — search covers the whole index, not the selected filter.',
  'idx.count.plain': '{n} names · ranked by what exists on chain, then newest first',
  'idx.empty.search': 'No name, display name or description in the index contains “{q}”.',
  'idx.empty.filter': 'No name in the index matches this filter yet.',

  /* --- tiers ---------------------------------------------------------
     Three tiers, and every one of them is a record ANY name can publish. The
     tier that used to sit above them — "live data", for the apps whose ABI we
     hard-coded — is gone; see 'method.p5'. */
  'tier.0': 'published',
  'tier.1': 'deployed',
  'tier.2': 'name only',
  'tier.reason.0.hash':
    'Published — a manifest record on the content resolver names and describes it, and a contenthash points at the deployed bundle.',
  'tier.reason.0.nohash':
    'Published — a manifest record names and describes it, but there is no contenthash: nothing is deployed behind the name yet.',
  'tier.reason.1':
    'Deployed — a contenthash points at a bundle, but no manifest record describes it, so the name and the bundle are all the chain will tell us.',
  'tier.reason.2': 'No contenthash — name registered, nothing deployed.',

  /* --- index row ----------------------------------------------------- */
  'row.registered': 'registered {ago}',
  'row.beforeRange': 'before the indexed range',
  'row.noManifest': 'No manifest record — the chain does not describe this name.',
  'row.reading': 'reading…',
  /* The per-app figure, and the only one on a row. It appears for every name
     that declares a `contract` record and for no other reason. The number is
     rendered separately, immediately before this string, so the whole thing
     reads "3 events · last 151 blocks (~5 min)". */
  'row.events': 'events · last {blocks} blocks (~{minutes} min)',
  'row.events.one': 'event · last {blocks} blocks (~{minutes} min)',
  'row.events.aria':
    '{events} contract events from the address {name} declares, over the last {blocks} blocks (about {minutes} minutes)',

  /* --- bundle liveness ------------------------------------------------
     Shown ONLY when the last probe could not reach a deployed bundle. An alive
     bundle shows nothing: reachable is the normal state of a published app, not
     a badge to earn. "Never seen" is deliberately its own sentence — a bundle
     our gateway has never served is not a bundle that died N days ago, and
     pretending to know when it was last up would be a lie. */
  'live.unreachable': 'bundle unreachable · {days} days',
  'live.unreachable.one': 'bundle unreachable · 1 day',
  'live.unreachable.today': 'bundle unreachable · since today',
  'live.never': 'bundle never seen by our gateway',

  /* --- expanded detail ----------------------------------------------- */
  'detail.owner': 'Owner',
  'detail.owner.none': 'not recorded in this snapshot',
  'detail.contenthash': 'Contenthash',
  'detail.contenthash.none': 'none',
  'detail.executable': 'Executable record',
  'detail.executable.yes': 'present on app.{id}.dot',
  'detail.executable.no': 'none on app.{id}.dot',
  'detail.registered': 'Registered',
  'detail.contract': 'Declared contract',
  'detail.contract.none': 'none — this name publishes no contract record',
  'detail.open': 'Open {domain} ↗',
  'feed.recent': 'recent',

  /* --- what dotmetrics reads itself -----------------------------------
     The four hard-coded contract readers, demoted to what they are. These
     figures are real, but obtaining them takes work only the index's operator
     can do, so they are labelled as ours and they rank nothing. */
  'ours.title': 'Read by dotmetrics',
  'ours.note':
    'dotmetrics hard-codes this app’s contract ABI, so these are our readings of it — our instrumentation, not something the app published, and not part of how it is ranked or ordered.',

  /* --- our copy for the four apps we read contracts for ---------------
     These are OURS, not the authors': dotmetrics wrote them for the apps whose
     contracts it reads directly, so unlike a manifest description they get
     translated rather than marked. */
  'app.tagline.openpetition': 'Petitions signed by real people — one signature per person.',
  'app.tagline.thebutton': 'One button, one press per human, ever.',
  'app.tagline.truereviews': 'One verified human, one review per place.',
  'app.tagline.discreetly':
    'Private bookings for real people — anonymous, sybil-proof, escrowed.',
  'app.tagline.generic': 'Registered on the .dot network.',

  /* --- metric labels, beside the measured figures --------------------- */
  'metric.petitions': 'petitions',
  'metric.verifiedSignatures': 'verified signatures',
  'metric.unverified': 'unverified',
  'metric.placesReviewed': 'places reviewed',
  'metric.servicesListed': 'services listed',
  'metric.bookings': 'bookings',
  'metric.presses': 'presses',
  'metric.humansRegistered': 'humans on the register',

  /* --- chat ---------------------------------------------------------- */
  'chat.idle': 'Chat',
  'chat.busy': '…',
  'chat.outside': 'Chat lives inside the Polkadot app',
  'chat.failed': 'Chat unavailable right now',
  'chat.registered': 'Room added — open the Chat tab',
  'chat.opened': 'Opened in chat ✓',

  /* --- chain vitals -------------------------------------------------- */
  'vitals.title': 'Chain vitals',
  'vitals.note': 'chain-wide, not per-app · measured {ago} at head #{head}',
  'vitals.legend.reverted': 'reverted',
  'vitals.legend.emitted': 'emitted',

  /* --- method -------------------------------------------------------- */
  'method.summary': 'Method — how these names were found, and what was thrown away',
  'method.p1':
    'Names are discovered by walking Asset Hub blocks — the registry can’t be listed by a contract call, so the plaintext comes from registration calldata. What’s real is here: when each name was registered, which records it publishes, and the contract events measured live over a stated window. Per-app usage is attributable only where a name says which address is its own, because nothing on chain links the two by itself — see the last paragraph.',
  'method.p2':
    'An ascii run in calldata is a lead, not a name. This scan proposed {scanned} labels; {rejected} of them returned a zero owner from {call} and were never registrations at all, so {kept} names remain. The rejected labels are listed rather than quietly dropped, because the gap between them is the difference between what a byte scan can see and what the registry actually holds:',
  'method.excluded.none': 'none in this snapshot',
  'method.p3':
    'Records are read from the content resolver at {resolver} directly, never by following {lookup} — that returns a dead resolver on this devnet whose {text} and {contenthash} revert for every name. Ownership comes from the registry at {registry}.',
  'method.p4':
    'Chain vitals count {event} over the last {blocks} blocks (~{minutes} min). Nothing on chain ties an address to a name, so this total is ecosystem-wide; a name that declares a {record} record has the count for its own address shown on its row, from this same window. The busiest addresses in that window:',
  'method.top.item': '{address} — {events} of {total} events',
  'method.top.none': 'no contract emitted an event in the measured window',
  'method.p5':
    'What changed. An earlier version of this page ranked apps by a tier only the index’s own operator could reach: the top rank was “live data”, and it went to the four apps whose contract ABI dotmetrics had hand-coded — all four of them ours. It was disclosed here, which did not make it fair, and it broke the rule the tiers exist for: a tier is meant to state a fact about the app, and that one stated a fact about our code. Ranking now uses facts anyone can satisfy — a manifest record, a contenthash, a registered name — and any app can be measured on its own row by publishing the address of its contract as a text record: {cmd}. Its {event} count over the window above then appears beside it, the same metric in the same words as for anyone else. {declared} of {all} indexed names declare one today. This is dotmetrics’ own convention and not a platform standard: no manifest field exists for a contract address, so we read a record instead. The four apps we hard-code readers for still report those figures, now labelled as our instrumentation and counting for nothing in the order.',
  'method.p6':
    'Liveness. Bulletin storage is a window, not forever, so every name with a contenthash is probed through one gateway, {gateway} — and through nothing else. “Unreachable” therefore means exactly this: that gateway did not serve the bundle when we asked. It is evidence about one door to the network, never proof the data is gone from it. If more than half of the bundles seen alive last time turn unreachable in a single run, the run is treated as a gateway failure and nothing is recorded — an index must not declare an ecosystem dead because one endpoint had a bad minute. Names that publish no contenthash are not probed at all: there is nothing behind the name to reach, so they can be neither alive nor unreachable.',

  /* --- footer ---------------------------------------------------------
     Three sources, three different freshness claims, stated as themselves:
     'record' — the CID the mutable `directory` record points at right now;
     'pinned' — the CID this build was compiled with, fetched from Bulletin;
     'baked'  — the compiled-in snapshot, nothing fetched at all. */
  'foot.prov.record': 'index live via the directory record · {cid}',
  'foot.prov.pinned': 'index from the CID pinned in this build · {cid}',
  'foot.prov.baked': 'index from the snapshot baked into this build — Bulletin unreachable',
  'foot.note':
    'Every figure is read live from Polkadot devnet Asset Hub over a public Ethereum RPC — no wallet, no sign-in, no personhood. Test network: tokens carry no value.',

  /* --- relative time ------------------------------------------------- */
  'ago.none': '—',
  'ago.now': 'just now',
  'ago.s': '{n}s ago',
  'ago.m': '{n}m ago',
  'ago.h1': '1h ago',
  'ago.h': '{n}h ago',
  'ago.d': '{n}d ago',

  /* --- pulse strip --------------------------------------------------- */
  'pulse.dead': 'no block feed',
  'pulse.waiting': 'waiting for heads',
  'pulse.stalled': 'stalled {n}s',
  'pulse.head': '#{head}',
  'pulse.head.avg': '#{head} · {avg}s avg',
  'pulse.aria.dead': 'Block pulse: the block feed could not be reached',
  'pulse.aria.waiting': 'Block pulse: no heads received yet',
  'pulse.aria.stalled':
    'Block pulse stalled: no new head for {n} seconds, last was {head}',
  'pulse.aria.ok': 'Block pulse: head {head}',
  'pulse.aria.ok.avg':
    'Block pulse: head {head}, {avg} second mean interval over the last {n} blocks',

  /* --- registration heatmap ------------------------------------------ */
  'heat.aria.empty': 'Registration heatmap: no registrations in the indexed range',
  'heat.aria':
    'Registration heatmap: {total} registrations across {days} UTC days, peak {max} in one hour. Arrow keys move between cells.',
  'heat.empty': '0 registrations in the indexed range — the grid fills as names arrive.',
  'heat.utc': 'UTC',
  'heat.tip.one': '1 name registered',
  'heat.tip.n': '{n} names registered',
  'heat.tip.when': '{day}, {hour}:00 UTC',
  'heat.tip.more': '+{n} more',

  /* --- step sparkline ------------------------------------------------ */
  'spark.aria': 'Cumulative registrations, {first} to {last}, rising to {n}',
  'spark.aria.empty':
    'Cumulative registrations: fewer than two dated registrations, nothing to plot',

  /* --- chain vitals readouts ----------------------------------------- */
  'vitals.aria':
    'Call outcomes over the last {blocks} blocks: {reverts} reverted and {events} emitted, of {calls} calls',
  'vitals.aria.none': 'Call outcomes: not measured yet',
  'vitals.measuring': 'measuring…',
  'vitals.blockTime': '{s}s blocks',
  'vitals.blockTime.sub': '{blocks} blocks in {secs}s (~{minutes} min)',
  'vitals.blockTime.none': 'no window measured yet',
  'vitals.events': '{n} events / 1k blocks',
  'vitals.events.sub.one': '{events} events from 1 contract · last {blocks} blocks',
  'vitals.events.sub': '{events} events from {contracts} contracts · last {blocks} blocks',
  'vitals.events.none': 'no events counted yet',
  'vitals.reverts': '{pct}% reverted',
  'vitals.reverts.sub': '{reverts} of {calls} calls · last {blocks} blocks (~{minutes} min)',
  'vitals.reverts.none': 'no calls seen in the window',
  'vitals.tip.calls': '{calls} contract calls in {blocks} blocks',
  'vitals.tip.split': '{reverts} reverted · {events} emitted',
  'vitals.tip.busiest': 'busiest {address} · {events} of {total} events',
  'vitals.tip.head': 'measured at head #{head}',

  /* --- third-party descriptions -------------------------------------- */
  /* These label OUR handling of an author's text. They never replace it. */
  'desc.marker.aria': 'This description is written in {language}',
  'desc.translate': 'translate',
  'desc.translate.aria': 'Machine-translate this description into {language}',
  'desc.translating': 'translating…',
  'desc.mt': 'Machine translation',
  'desc.mt.via': '{from} → {to} via {service} · not the author’s words',
  'desc.original': 'show original',
  'desc.error': 'Translation failed — {reason}',
  'desc.retry': 'try again',

  /* --- language names, for the marker and the translation banner ------ */
  'lang.name.en': 'English',
  'lang.name.it': 'Italian',
  'lang.name.fr': 'French',
  'lang.name.es': 'Spanish',
  'lang.name.de': 'German',
  'lang.name.pt': 'Portuguese',
  'lang.name.nl': 'Dutch',
  'lang.name.zh': 'Chinese',
  'lang.name.ja': 'Japanese',
  'lang.name.ko': 'Korean',
  'lang.name.ru': 'Russian',
  'lang.name.ar': 'Arabic',
  'lang.name.el': 'Greek',
  'lang.name.he': 'Hebrew',
  'lang.name.hi': 'Hindi',

  /* --- translation failure reasons ----------------------------------- */
  'tr.err.offline': 'the device is offline',
  'tr.err.http': 'the translation service answered HTTP {status}',
  'tr.err.empty': 'the translation service returned an empty response',
  'tr.err.badJson': 'the translation service returned something that is not JSON',
  'tr.err.timeout': 'the translation service did not answer in time',
  'tr.err.network': 'the translation service could not be reached',
  'tr.err.tooLong': 'this description is {n} characters and the service accepts {max}',
  'tr.err.quota': 'the free daily quota for this network is used up',
  'tr.err.service': '{detail}',
} as const;

export type MsgKey = keyof typeof EN;

/**
 * The Italian side.
 *
 * Typed as a full `Record<MsgKey, string>` on purpose: this is the check that a
 * new English string cannot ship without its Italian counterpart. Prose is
 * translated in full, not summarised — the Method block especially, which is
 * the page admitting what its own numbers cannot show.
 */
const IT: Record<MsgKey, string> = {
  /* --- top bar ------------------------------------------------------- */
  'bar.devnet': 'devnet',
  'lang.aria': 'Lingua dell’interfaccia',
  'lang.trigger.aria': 'Lingua dell’interfaccia: {language}. Scegline un’altra.',
  'lang.switch.aria': 'Cambia la lingua dell’interfaccia in {language}',

  /* --- search -------------------------------------------------------- */
  'search.placeholder': 'Cerca fra {n} app .dot per nome o descrizione',
  'search.aria': 'Cerca in ogni nome .dot indicizzato, nome visualizzato e descrizione',
  'search.clear': 'Cancella la ricerca',

  /* --- headline pair ------------------------------------------------- */
  'hero.line':
    'app indicizzate · {published} pubblicate · {deployed} distribuite · {declared} che dichiarano un contratto · {updated}',
  'hero.updated': 'aggiornato {ago}',
  'hero.rpcDown': 'rpc irraggiungibile',
  'hero.rpcFallback': 'primo rpc non risponde · lettura tramite {host}, endpoint {using} di {total}',
  'reg.title': 'Registrazioni',
  'reg.note':
    'una cella per ogni ora UTC · una riga per ogni giorno UTC · totale del giorno nella colonna a destra',
  'reg.legend': 'nomi registrati',

  /* --- facets -------------------------------------------------------- */
  'facets.aria': 'Filtra l’indice in base a ciò che esiste sulla catena',
  'facet.all': 'Tutte',
  'facet.published': 'Pubblicate',
  'facet.deployed': 'Distribuite',
  'facet.name': 'Solo nome',
  'facet.declared': 'Dichiarano un contratto',
  'facet.new': 'Nuove oggi',
  'facet.unreachable': 'Irraggiungibili',

  /* --- the index ----------------------------------------------------- */
  'idx.count.search':
    '{shown} nomi su {all} corrispondono a “{q}” — la ricerca copre tutto l’indice, non il filtro selezionato.',
  'idx.count.plain':
    '{n} nomi · ordinati per ciò che esiste sulla catena, poi dal più recente',
  'idx.empty.search':
    'Nessun nome, nome visualizzato o descrizione nell’indice contiene “{q}”.',
  'idx.empty.filter': 'Nessun nome nell’indice corrisponde ancora a questo filtro.',

  /* --- tiers --------------------------------------------------------- */
  'tier.0': 'pubblicata',
  'tier.1': 'distribuita',
  'tier.2': 'solo nome',
  'tier.reason.0.hash':
    'Pubblicata — un record manifest sul content resolver la nomina e la descrive, e un contenthash punta al bundle distribuito.',
  'tier.reason.0.nohash':
    'Pubblicata — un record manifest la nomina e la descrive, ma non esiste un contenthash: dietro il nome non è ancora distribuito nulla.',
  'tier.reason.1':
    'Distribuita — un contenthash punta a un bundle, ma nessun record manifest lo descrive: il nome e il bundle sono tutto ciò che la catena ci dice.',
  'tier.reason.2': 'Nessun contenthash — nome registrato, nulla distribuito.',

  /* --- index row ----------------------------------------------------- */
  'row.registered': 'registrato {ago}',
  'row.beforeRange': 'prima dell’intervallo indicizzato',
  'row.noManifest': 'Nessun record manifest — la catena non descrive questo nome.',
  'row.reading': 'lettura…',
  'row.events': 'eventi · ultimi {blocks} blocchi (~{minutes} min)',
  'row.events.one': 'evento · ultimi {blocks} blocchi (~{minutes} min)',
  'row.events.aria':
    '{events} eventi di contratto dall’indirizzo dichiarato da {name}, negli ultimi {blocks} blocchi (circa {minutes} minuti)',

  /* --- bundle liveness ------------------------------------------------ */
  'live.unreachable': 'bundle irraggiungibile · {days} giorni',
  'live.unreachable.one': 'bundle irraggiungibile · 1 giorno',
  'live.unreachable.today': 'bundle irraggiungibile · da oggi',
  'live.never': 'bundle mai visto dal nostro gateway',

  /* --- expanded detail ----------------------------------------------- */
  'detail.owner': 'Proprietario',
  'detail.owner.none': 'non registrato in questo snapshot',
  'detail.contenthash': 'Contenthash',
  'detail.contenthash.none': 'nessuno',
  'detail.executable': 'Record executable',
  'detail.executable.yes': 'presente su app.{id}.dot',
  'detail.executable.no': 'assente su app.{id}.dot',
  'detail.registered': 'Registrato',
  'detail.contract': 'Contratto dichiarato',
  'detail.contract.none': 'nessuno — questo nome non pubblica alcun record contract',
  'detail.open': 'Apri {domain} ↗',
  'feed.recent': 'di recente',

  /* --- what dotmetrics reads itself ---------------------------------- */
  'ours.title': 'Letto da dotmetrics',
  'ours.note':
    'dotmetrics tiene scritta a mano l’ABI del contratto di questa app, quindi queste sono nostre letture — strumentazione nostra, non qualcosa che l’app ha pubblicato, e non fanno parte di come viene ordinata o posizionata.',

  /* --- our copy for the four apps we read contracts for --------------- */
  'app.tagline.openpetition':
    'Petizioni firmate da persone reali — una firma per persona.',
  'app.tagline.thebutton': 'Un pulsante, una pressione per essere umano, per sempre.',
  'app.tagline.truereviews': 'Una persona verificata, una recensione per ogni luogo.',
  'app.tagline.discreetly':
    'Prenotazioni private per persone reali — anonime, a prova di sybil, con deposito a garanzia.',
  'app.tagline.generic': 'Registrato sulla rete .dot.',

  /* --- metric labels, beside the measured figures --------------------- */
  'metric.petitions': 'petizioni',
  'metric.verifiedSignatures': 'firme verificate',
  'metric.unverified': 'non verificate',
  'metric.placesReviewed': 'luoghi recensiti',
  'metric.servicesListed': 'servizi elencati',
  'metric.bookings': 'prenotazioni',
  'metric.presses': 'pressioni',
  'metric.humansRegistered': 'persone nel registro',

  /* --- chat ---------------------------------------------------------- */
  'chat.idle': 'Chat',
  'chat.busy': '…',
  'chat.outside': 'La chat vive dentro l’app Polkadot',
  'chat.failed': 'Chat non disponibile al momento',
  'chat.registered': 'Stanza aggiunta — apri la scheda Chat',
  'chat.opened': 'Aperta in chat ✓',

  /* --- chain vitals -------------------------------------------------- */
  'vitals.title': 'Parametri vitali della catena',
  'vitals.note':
    'a livello di catena, non per singola app · misurato {ago} all’altezza #{head}',
  'vitals.legend.reverted': 'annullate',
  'vitals.legend.emitted': 'emessi',

  /* --- method -------------------------------------------------------- */
  'method.summary': 'Metodo — come sono stati trovati questi nomi, e cosa è stato scartato',
  'method.p1':
    'I nomi vengono scoperti percorrendo i blocchi di Asset Hub — il registro non può essere elencato con una chiamata al contratto, quindi il testo in chiaro proviene dalla calldata di registrazione. Ciò che è reale è qui: quando ogni nome è stato registrato, quali record pubblica, e gli eventi dei contratti misurati in diretta su una finestra dichiarata. L’uso per singola app è attribuibile solo dove un nome dichiara quale indirizzo gli appartiene, perché sulla catena nulla lega i due da sé — vedi l’ultimo paragrafo.',
  'method.p2':
    'Una sequenza ascii nella calldata è un indizio, non un nome. Questa scansione ha proposto {scanned} etichette; {rejected} di esse hanno restituito un proprietario nullo da {call} e non erano affatto registrazioni, quindi restano {kept} nomi. Le etichette scartate sono elencate invece di essere fatte sparire in silenzio, perché la distanza fra le due cifre è la differenza fra ciò che una scansione di byte riesce a vedere e ciò che il registro contiene davvero:',
  'method.excluded.none': 'nessuna in questo snapshot',
  'method.p3':
    'I record vengono letti direttamente dal content resolver all’indirizzo {resolver}, mai seguendo {lookup} — che su questa devnet restituisce un resolver morto, i cui {text} e {contenthash} falliscono per ogni nome. La proprietà proviene dal registro all’indirizzo {registry}.',
  'method.p4':
    'I parametri vitali della catena contano {event} negli ultimi {blocks} blocchi (~{minutes} min). Sulla catena nulla lega un indirizzo a un nome, quindi questo totale riguarda l’intero ecosistema; un nome che dichiara un record {record} vede il conteggio del proprio indirizzo sulla sua riga, dalla stessa finestra. Gli indirizzi più attivi in quella finestra:',
  'method.top.item': '{address} — {events} eventi su {total}',
  'method.top.none': 'nessun contratto ha emesso eventi nella finestra misurata',
  'method.p5':
    'Cosa è cambiato. Una versione precedente di questa pagina ordinava le app secondo un livello raggiungibile solo da chi gestisce l’indice: il primo posto era «dati in diretta», e andava alle quattro app di cui dotmetrics teneva scritta a mano l’ABI del contratto — tutte e quattro nostre. Era dichiarato qui, il che non lo rendeva equo, e contraddiceva la regola per cui i livelli esistono: un livello dovrebbe dire un fatto sull’app, e quello diceva un fatto sul nostro codice. Ora l’ordinamento usa fatti che chiunque può soddisfare — un record manifest, un contenthash, un nome registrato — e qualsiasi app può essere misurata sulla propria riga pubblicando l’indirizzo del proprio contratto come record di testo: {cmd}. Il suo conteggio di {event} sulla finestra qui sopra compare allora accanto ad essa, stessa metrica e stesse parole che per chiunque altro. Oggi lo dichiarano {declared} nomi su {all}. Questa è una convenzione di dotmetrics e non uno standard della piattaforma: non esiste un campo del manifest per l’indirizzo di un contratto, quindi leggiamo un record. Le quattro app di cui teniamo un lettore riportano ancora quelle cifre, ora etichettate come nostra strumentazione e senza alcun peso nell’ordine.',
  'method.p6':
    'Vitalità. Lo storage di Bulletin è una finestra, non un per sempre, quindi ogni nome con un contenthash viene sondato attraverso un solo gateway, {gateway} — e attraverso nient’altro. «Irraggiungibile» significa dunque esattamente questo: quel gateway non ha servito il bundle quando gliel’abbiamo chiesto. È una prova su una sola porta della rete, mai la prova che i dati ne siano spariti. Se più della metà dei bundle visti vivi la volta scorsa risulta irraggiungibile in una singola esecuzione, l’esecuzione viene trattata come un guasto del gateway e nulla viene registrato: un indice non deve dichiarare morto un ecosistema perché un endpoint ha avuto un minuto storto. I nomi che non pubblicano alcun contenthash non vengono sondati affatto: dietro il nome non c’è nulla da raggiungere, quindi non possono essere né vivi né irraggiungibili.',

  /* --- footer -------------------------------------------------------- */
  'foot.prov.record': 'indice in diretta tramite il record directory · {cid}',
  'foot.prov.pinned': 'indice dal CID fissato in questa build · {cid}',
  'foot.prov.baked':
    'indice dallo snapshot incorporato in questa build — Bulletin irraggiungibile',
  'foot.note':
    'Ogni cifra è letta in diretta da Polkadot devnet Asset Hub tramite un RPC Ethereum pubblico — nessun wallet, nessun accesso, nessuna prova di identità. Rete di test: i token non hanno alcun valore.',

  /* --- relative time ------------------------------------------------- */
  'ago.none': '—',
  'ago.now': 'proprio ora',
  'ago.s': '{n}s fa',
  'ago.m': '{n}m fa',
  'ago.h1': '1h fa',
  'ago.h': '{n}h fa',
  'ago.d': '{n}g fa',

  /* --- pulse strip --------------------------------------------------- */
  'pulse.dead': 'nessun flusso di blocchi',
  'pulse.waiting': 'in attesa di blocchi',
  'pulse.stalled': 'fermo da {n}s',
  'pulse.head': '#{head}',
  'pulse.head.avg': '#{head} · {avg}s medi',
  'pulse.aria.dead': 'Battito dei blocchi: il flusso dei blocchi non è raggiungibile',
  'pulse.aria.waiting': 'Battito dei blocchi: nessun blocco ricevuto finora',
  'pulse.aria.stalled':
    'Battito dei blocchi fermo: nessun nuovo blocco da {n} secondi, l’ultimo era {head}',
  'pulse.aria.ok': 'Battito dei blocchi: altezza {head}',
  'pulse.aria.ok.avg':
    'Battito dei blocchi: altezza {head}, intervallo medio di {avg} secondi sugli ultimi {n} blocchi',

  /* --- registration heatmap ------------------------------------------ */
  'heat.aria.empty':
    'Mappa di calore delle registrazioni: nessuna registrazione nell’intervallo indicizzato',
  'heat.aria':
    'Mappa di calore delle registrazioni: {total} registrazioni su {days} giorni UTC, picco di {max} in un’ora. Le frecce spostano fra le celle.',
  'heat.empty':
    '0 registrazioni nell’intervallo indicizzato — la griglia si riempie man mano che arrivano i nomi.',
  'heat.utc': 'UTC',
  'heat.tip.one': '1 nome registrato',
  'heat.tip.n': '{n} nomi registrati',
  'heat.tip.when': '{day}, ore {hour}:00 UTC',
  'heat.tip.more': '+{n} altri',

  /* --- step sparkline ------------------------------------------------ */
  'spark.aria': 'Registrazioni cumulative, dal {first} al {last}, fino a {n}',
  'spark.aria.empty':
    'Registrazioni cumulative: meno di due registrazioni datate, nulla da tracciare',

  /* --- chain vitals readouts ----------------------------------------- */
  'vitals.aria':
    'Esito delle chiamate negli ultimi {blocks} blocchi: {reverts} annullate e {events} emessi, su {calls} chiamate',
  'vitals.aria.none': 'Esito delle chiamate: non ancora misurato',
  'vitals.measuring': 'misurazione…',
  'vitals.blockTime': 'blocchi da {s}s',
  'vitals.blockTime.sub': '{blocks} blocchi in {secs}s (~{minutes} min)',
  'vitals.blockTime.none': 'nessuna finestra ancora misurata',
  'vitals.events': '{n} eventi / 1k blocchi',
  'vitals.events.sub.one': '{events} eventi da 1 contratto · ultimi {blocks} blocchi',
  'vitals.events.sub': '{events} eventi da {contracts} contratti · ultimi {blocks} blocchi',
  'vitals.events.none': 'nessun evento ancora conteggiato',
  'vitals.reverts': '{pct}% annullate',
  'vitals.reverts.sub':
    '{reverts} chiamate su {calls} · ultimi {blocks} blocchi (~{minutes} min)',
  'vitals.reverts.none': 'nessuna chiamata vista nella finestra',
  'vitals.tip.calls': '{calls} chiamate ai contratti in {blocks} blocchi',
  'vitals.tip.split': '{reverts} annullate · {events} emessi',
  'vitals.tip.busiest': 'più attivo {address} · {events} eventi su {total}',
  'vitals.tip.head': 'misurato all’altezza #{head}',

  /* --- third-party descriptions -------------------------------------- */
  'desc.marker.aria': 'Questa descrizione è scritta in {language}',
  'desc.translate': 'traduci',
  'desc.translate.aria': 'Traduci automaticamente questa descrizione in {language}',
  'desc.translating': 'traduzione…',
  'desc.mt': 'Traduzione automatica',
  'desc.mt.via': '{from} → {to} tramite {service} · non sono le parole dell’autore',
  'desc.original': 'mostra l’originale',
  'desc.error': 'Traduzione non riuscita — {reason}',
  'desc.retry': 'riprova',

  /* --- language names ------------------------------------------------ */
  'lang.name.en': 'inglese',
  'lang.name.it': 'italiano',
  'lang.name.fr': 'francese',
  'lang.name.es': 'spagnolo',
  'lang.name.de': 'tedesco',
  'lang.name.pt': 'portoghese',
  'lang.name.nl': 'olandese',
  'lang.name.zh': 'cinese',
  'lang.name.ja': 'giapponese',
  'lang.name.ko': 'coreano',
  'lang.name.ru': 'russo',
  'lang.name.ar': 'arabo',
  'lang.name.el': 'greco',
  'lang.name.he': 'ebraico',
  'lang.name.hi': 'hindi',

  /* --- translation failure reasons ----------------------------------- */
  'tr.err.offline': 'il dispositivo è offline',
  'tr.err.http': 'il servizio di traduzione ha risposto HTTP {status}',
  'tr.err.empty': 'il servizio di traduzione ha restituito una risposta vuota',
  'tr.err.badJson': 'il servizio di traduzione ha restituito qualcosa che non è JSON',
  'tr.err.timeout': 'il servizio di traduzione non ha risposto in tempo',
  'tr.err.network': 'non è stato possibile raggiungere il servizio di traduzione',
  'tr.err.tooLong': 'questa descrizione ha {n} caratteri e il servizio ne accetta {max}',
  'tr.err.quota': 'la quota gratuita giornaliera per questa rete è esaurita',
  'tr.err.service': '{detail}',
};

/**
 * The Spanish side.
 *
 * Same register as the Italian: impersonal, no marketing, and the terms of art
 * this ecosystem uses in English stay in English — record, manifest,
 * contenthash, content resolver, bundle, gateway, endpoint, snapshot, devnet,
 * wallet, token, CID, ABI, calldata. Translating `contenthash` to
 * `hash de contenido` would invent a word nobody searching for it would type.
 *
 * Imperatives address the reader as `tú`, which is what the Italian does and
 * what Spanish interfaces do.
 */
const ES: Record<MsgKey, string> = {
  /* --- top bar ------------------------------------------------------- */
  'bar.devnet': 'devnet',
  'lang.aria': 'Idioma de la interfaz',
  'lang.trigger.aria': 'Idioma de la interfaz: {language}. Elige otro.',
  'lang.switch.aria': 'Cambiar el idioma de la interfaz a {language}',

  /* --- search -------------------------------------------------------- */
  'search.placeholder': 'Busca entre {n} apps .dot por nombre o descripción',
  'search.aria': 'Busca en cada nombre .dot indexado, nombre visible y descripción',
  'search.clear': 'Borrar la búsqueda',

  /* --- headline pair ------------------------------------------------- */
  /* "con contrato declarado" and not "que declaran un contrato": {declared} is
     often 1, and a plural verb on a count of one reads as a bug in the figure
     rather than in the sentence. The French gets this free — "déclarant" is an
     invariable participle — and the English never had the problem. */
  'hero.line':
    'apps indexadas · {published} publicadas · {deployed} desplegadas · {declared} con contrato declarado · {updated}',
  'hero.updated': 'actualizado {ago}',
  'hero.rpcDown': 'rpc inaccesible',
  'hero.rpcFallback':
    'primer rpc caído · leyendo a través de {host}, endpoint {using} de {total}',
  'reg.title': 'Registros',
  'reg.note':
    'una celda por cada hora UTC · una fila por cada día UTC · total del día en la columna de la derecha',
  'reg.legend': 'nombres registrados',

  /* --- facets -------------------------------------------------------- */
  'facets.aria': 'Filtra el índice según lo que existe en la cadena',
  'facet.all': 'Todas',
  'facet.published': 'Publicadas',
  'facet.deployed': 'Desplegadas',
  'facet.name': 'Solo nombre',
  'facet.declared': 'Declaran contrato',
  'facet.new': 'Nuevas hoy',
  'facet.unreachable': 'Inaccesibles',

  /* --- the index ----------------------------------------------------- */
  'idx.count.search':
    '{shown} nombres de {all} coinciden con “{q}” — la búsqueda cubre todo el índice, no el filtro seleccionado.',
  'idx.count.plain':
    '{n} nombres · ordenados por lo que existe en la cadena, luego del más reciente',
  'idx.empty.search':
    'Ningún nombre, nombre visible o descripción del índice contiene “{q}”.',
  'idx.empty.filter': 'Ningún nombre del índice coincide todavía con este filtro.',

  /* --- tiers --------------------------------------------------------- */
  'tier.0': 'publicada',
  'tier.1': 'desplegada',
  'tier.2': 'solo nombre',
  'tier.reason.0.hash':
    'Publicada — un record manifest en el content resolver la nombra y la describe, y un contenthash apunta al bundle desplegado.',
  'tier.reason.0.nohash':
    'Publicada — un record manifest la nombra y la describe, pero no hay contenthash: detrás del nombre todavía no hay nada desplegado.',
  'tier.reason.1':
    'Desplegada — un contenthash apunta a un bundle, pero ningún record manifest lo describe: el nombre y el bundle son todo lo que la cadena nos dice.',
  'tier.reason.2': 'Sin contenthash — nombre registrado, nada desplegado.',

  /* --- index row ----------------------------------------------------- */
  'row.registered': 'registrado {ago}',
  'row.beforeRange': 'antes del intervalo indexado',
  'row.noManifest': 'Ningún record manifest — la cadena no describe este nombre.',
  'row.reading': 'leyendo…',
  'row.events': 'eventos · últimos {blocks} bloques (~{minutes} min)',
  'row.events.one': 'evento · últimos {blocks} bloques (~{minutes} min)',
  'row.events.aria':
    '{events} eventos de contrato desde la dirección que declara {name}, en los últimos {blocks} bloques (unos {minutes} minutos)',

  /* --- bundle liveness ------------------------------------------------ */
  'live.unreachable': 'bundle inaccesible · {days} días',
  'live.unreachable.one': 'bundle inaccesible · 1 día',
  'live.unreachable.today': 'bundle inaccesible · desde hoy',
  'live.never': 'bundle nunca visto por nuestro gateway',

  /* --- expanded detail ----------------------------------------------- */
  'detail.owner': 'Propietario',
  'detail.owner.none': 'no registrado en este snapshot',
  'detail.contenthash': 'Contenthash',
  'detail.contenthash.none': 'ninguno',
  'detail.executable': 'Record executable',
  'detail.executable.yes': 'presente en app.{id}.dot',
  'detail.executable.no': 'ausente en app.{id}.dot',
  'detail.registered': 'Registrado',
  'detail.contract': 'Contrato declarado',
  'detail.contract.none': 'ninguno — este nombre no publica ningún record contract',
  'detail.open': 'Abrir {domain} ↗',
  'feed.recent': 'reciente',

  /* --- what dotmetrics reads itself ---------------------------------- */
  'ours.title': 'Leído por dotmetrics',
  'ours.note':
    'dotmetrics lleva escrita a mano la ABI del contrato de esta app, así que estas son lecturas nuestras — instrumentación nuestra, no algo que la app haya publicado, y no forman parte de cómo se ordena ni de cómo se clasifica.',

  /* --- our copy for the four apps we read contracts for --------------- */
  'app.tagline.openpetition': 'Peticiones firmadas por personas reales — una firma por persona.',
  'app.tagline.thebutton': 'Un botón, una pulsación por ser humano, para siempre.',
  'app.tagline.truereviews': 'Una persona verificada, una reseña por cada lugar.',
  'app.tagline.discreetly':
    'Reservas privadas para personas reales — anónimas, a prueba de sybil, con depósito en garantía.',
  'app.tagline.generic': 'Registrado en la red .dot.',

  /* --- metric labels, beside the measured figures --------------------- */
  'metric.petitions': 'peticiones',
  'metric.verifiedSignatures': 'firmas verificadas',
  'metric.unverified': 'sin verificar',
  'metric.placesReviewed': 'lugares reseñados',
  'metric.servicesListed': 'servicios listados',
  'metric.bookings': 'reservas',
  'metric.presses': 'pulsaciones',
  'metric.humansRegistered': 'personas en el registro',

  /* --- chat ---------------------------------------------------------- */
  'chat.idle': 'Chat',
  'chat.busy': '…',
  'chat.outside': 'El chat vive dentro de la app Polkadot',
  'chat.failed': 'Chat no disponible en este momento',
  'chat.registered': 'Sala añadida — abre la pestaña Chat',
  'chat.opened': 'Abierto en el chat ✓',

  /* --- chain vitals -------------------------------------------------- */
  'vitals.title': 'Constantes vitales de la cadena',
  'vitals.note': 'a nivel de cadena, no por app · medido {ago} a la altura #{head}',
  'vitals.legend.reverted': 'revertidas',
  'vitals.legend.emitted': 'emitidos',

  /* --- method -------------------------------------------------------- */
  'method.summary': 'Método — cómo se encontraron estos nombres, y qué se descartó',
  'method.p1':
    'Los nombres se descubren recorriendo los bloques de Asset Hub — el registro no puede enumerarse con una llamada al contrato, así que el texto en claro procede de la calldata de registro. Lo que es real está aquí: cuándo se registró cada nombre, qué records publica, y los eventos de los contratos medidos en directo sobre una ventana declarada. El uso por app solo es atribuible allí donde un nombre declara qué dirección le pertenece, porque en la cadena nada liga las dos cosas por sí mismo — véase el último párrafo.',
  'method.p2':
    'Una secuencia ascii en la calldata es una pista, no un nombre. Este escaneo propuso {scanned} etiquetas; {rejected} de ellas devolvieron un propietario nulo desde {call} y no eran registros en absoluto, así que quedan {kept} nombres. Las etiquetas descartadas se enumeran en vez de desaparecer en silencio, porque la distancia entre ambas cifras es la diferencia entre lo que un escaneo de bytes alcanza a ver y lo que el registro contiene de verdad:',
  'method.excluded.none': 'ninguna en este snapshot',
  'method.p3':
    'Los records se leen directamente del content resolver en {resolver}, nunca siguiendo {lookup} — que en esta devnet devuelve un resolver muerto, cuyos {text} y {contenthash} fallan para cada nombre. La propiedad procede del registro en {registry}.',
  'method.p4':
    'Las constantes vitales de la cadena cuentan {event} en los últimos {blocks} bloques (~{minutes} min). En la cadena nada liga una dirección a un nombre, así que este total abarca todo el ecosistema; un nombre que declara un record {record} ve el recuento de su propia dirección en su fila, desde esta misma ventana. Las direcciones más activas en esa ventana:',
  'method.top.item': '{address} — {events} eventos de {total}',
  'method.top.none': 'ningún contrato emitió eventos en la ventana medida',
  'method.p5':
    'Qué ha cambiado. Una versión anterior de esta página ordenaba las apps según un nivel que solo podía alcanzar quien opera el índice: el primer puesto era «datos en directo», y correspondía a las cuatro apps cuya ABI de contrato dotmetrics llevaba escrita a mano — las cuatro nuestras. Se declaraba aquí, lo cual no lo hacía justo, y rompía la regla por la que los niveles existen: un nivel debe enunciar un hecho sobre la app, y aquel enunciaba un hecho sobre nuestro código. Ahora el orden usa hechos que cualquiera puede cumplir — un record manifest, un contenthash, un nombre registrado — y cualquier app puede medirse en su propia fila publicando la dirección de su contrato como record de texto: {cmd}. Su recuento de {event} sobre la ventana de arriba aparece entonces junto a ella, la misma métrica y las mismas palabras que para cualquier otro. Hoy lo declaran {declared} de {all} nombres indexados. Esta es una convención de dotmetrics y no un estándar de la plataforma: no existe ningún campo del manifest para la dirección de un contrato, así que en su lugar leemos un record. Las cuatro apps para las que llevamos un lector siguen dando esas cifras, ahora etiquetadas como instrumentación nuestra y sin ningún peso en el orden.',
  'method.p6':
    'Vitalidad. El almacenamiento de Bulletin es una ventana, no un para siempre, así que cada nombre con un contenthash se sondea a través de un único gateway, {gateway} — y a través de ningún otro. «Inaccesible» significa por tanto exactamente esto: ese gateway no sirvió el bundle cuando se lo pedimos. Es una prueba sobre una sola puerta de la red, nunca la prueba de que los datos hayan desaparecido de ella. Si más de la mitad de los bundles vistos vivos la vez anterior resulta inaccesible en una sola ejecución, la ejecución se trata como un fallo del gateway y no se registra nada: un índice no debe declarar muerto un ecosistema porque un endpoint haya tenido un mal minuto. Los nombres que no publican ningún contenthash no se sondean en absoluto: detrás del nombre no hay nada que alcanzar, así que no pueden estar ni vivos ni inaccesibles.',

  /* --- footer -------------------------------------------------------- */
  'foot.prov.record': 'índice en directo mediante el record directory · {cid}',
  'foot.prov.pinned': 'índice desde el CID fijado en esta build · {cid}',
  'foot.prov.baked':
    'índice desde el snapshot incorporado en esta build — Bulletin inaccesible',
  'foot.note':
    'Cada cifra se lee en directo desde Polkadot devnet Asset Hub a través de un RPC Ethereum público — sin wallet, sin acceso, sin prueba de identidad. Red de pruebas: los tokens no tienen ningún valor.',

  /* --- relative time ------------------------------------------------- */
  'ago.none': '—',
  'ago.now': 'ahora mismo',
  'ago.s': 'hace {n}s',
  'ago.m': 'hace {n}min',
  'ago.h1': 'hace 1h',
  'ago.h': 'hace {n}h',
  'ago.d': 'hace {n}d',

  /* --- pulse strip --------------------------------------------------- */
  'pulse.dead': 'sin flujo de bloques',
  'pulse.waiting': 'esperando bloques',
  'pulse.stalled': 'parado {n}s',
  'pulse.head': '#{head}',
  'pulse.head.avg': '#{head} · {avg}s de media',
  'pulse.aria.dead': 'Pulso de bloques: no se ha podido alcanzar el flujo de bloques',
  'pulse.aria.waiting': 'Pulso de bloques: todavía no se ha recibido ningún bloque',
  'pulse.aria.stalled':
    'Pulso de bloques parado: ningún bloque nuevo desde hace {n} segundos, el último fue {head}',
  'pulse.aria.ok': 'Pulso de bloques: altura {head}',
  'pulse.aria.ok.avg':
    'Pulso de bloques: altura {head}, intervalo medio de {avg} segundos en los últimos {n} bloques',

  /* --- registration heatmap ------------------------------------------ */
  'heat.aria.empty':
    'Mapa de calor de registros: ningún registro en el intervalo indexado',
  'heat.aria':
    'Mapa de calor de registros: {total} registros a lo largo de {days} días UTC, pico de {max} en una hora. Las flechas mueven entre celdas.',
  'heat.empty':
    '0 registros en el intervalo indexado — la rejilla se llena a medida que llegan los nombres.',
  'heat.utc': 'UTC',
  'heat.tip.one': '1 nombre registrado',
  'heat.tip.n': '{n} nombres registrados',
  'heat.tip.when': '{day}, {hour}:00 UTC',
  'heat.tip.more': '+{n} más',

  /* --- step sparkline ------------------------------------------------ */
  'spark.aria': 'Registros acumulados, de {first} a {last}, hasta {n}',
  'spark.aria.empty':
    'Registros acumulados: menos de dos registros con fecha, nada que trazar',

  /* --- chain vitals readouts ----------------------------------------- */
  'vitals.aria':
    'Resultado de las llamadas en los últimos {blocks} bloques: {reverts} revertidas y {events} emitidos, de {calls} llamadas',
  'vitals.aria.none': 'Resultado de las llamadas: todavía sin medir',
  'vitals.measuring': 'midiendo…',
  'vitals.blockTime': 'bloques de {s}s',
  'vitals.blockTime.sub': '{blocks} bloques en {secs}s (~{minutes} min)',
  'vitals.blockTime.none': 'todavía sin ninguna ventana medida',
  'vitals.events': '{n} eventos / 1k bloques',
  'vitals.events.sub.one': '{events} eventos de 1 contrato · últimos {blocks} bloques',
  'vitals.events.sub': '{events} eventos de {contracts} contratos · últimos {blocks} bloques',
  'vitals.events.none': 'todavía sin ningún evento contado',
  'vitals.reverts': '{pct}% revertidas',
  'vitals.reverts.sub':
    '{reverts} llamadas de {calls} · últimos {blocks} bloques (~{minutes} min)',
  'vitals.reverts.none': 'ninguna llamada vista en la ventana',
  'vitals.tip.calls': '{calls} llamadas a contratos en {blocks} bloques',
  'vitals.tip.split': '{reverts} revertidas · {events} emitidos',
  'vitals.tip.busiest': 'más activa {address} · {events} eventos de {total}',
  'vitals.tip.head': 'medido a la altura #{head}',

  /* --- third-party descriptions -------------------------------------- */
  'desc.marker.aria': 'Esta descripción está escrita en {language}',
  'desc.translate': 'traducir',
  'desc.translate.aria': 'Traducir automáticamente esta descripción a {language}',
  'desc.translating': 'traduciendo…',
  'desc.mt': 'Traducción automática',
  'desc.mt.via': '{from} → {to} mediante {service} · no son las palabras del autor',
  'desc.original': 'mostrar el original',
  'desc.error': 'Traducción fallida — {reason}',
  'desc.retry': 'reintentar',

  /* --- language names ------------------------------------------------ */
  'lang.name.en': 'inglés',
  'lang.name.it': 'italiano',
  'lang.name.fr': 'francés',
  'lang.name.es': 'español',
  'lang.name.de': 'alemán',
  'lang.name.pt': 'portugués',
  'lang.name.nl': 'neerlandés',
  'lang.name.zh': 'chino',
  'lang.name.ja': 'japonés',
  'lang.name.ko': 'coreano',
  'lang.name.ru': 'ruso',
  'lang.name.ar': 'árabe',
  'lang.name.el': 'griego',
  'lang.name.he': 'hebreo',
  'lang.name.hi': 'hindi',

  /* --- translation failure reasons ----------------------------------- */
  'tr.err.offline': 'el dispositivo está sin conexión',
  'tr.err.http': 'el servicio de traducción respondió HTTP {status}',
  'tr.err.empty': 'el servicio de traducción devolvió una respuesta vacía',
  'tr.err.badJson': 'el servicio de traducción devolvió algo que no es JSON',
  'tr.err.timeout': 'el servicio de traducción no respondió a tiempo',
  'tr.err.network': 'no se ha podido alcanzar el servicio de traducción',
  'tr.err.tooLong': 'esta descripción tiene {n} caracteres y el servicio acepta {max}',
  'tr.err.quota': 'la cuota diaria gratuita para esta red se ha agotado',
  'tr.err.service': '{detail}',
};

/**
 * The French side.
 *
 * Same rules as the Spanish. Two French-specific conventions, applied
 * throughout so they cannot drift: the reader is addressed as `vous`, and
 * `« »` carry inner spaces. The space before `:` and `;` is an ordinary space
 * rather than U+00A0 — an invisible character in a source file is a bug
 * waiting to be pasted over, and an orphaned colon is the cheaper problem.
 */
const FR: Record<MsgKey, string> = {
  /* --- top bar ------------------------------------------------------- */
  'bar.devnet': 'devnet',
  'lang.aria': 'Langue de l’interface',
  'lang.trigger.aria': 'Langue de l’interface : {language}. Choisissez-en une autre.',
  'lang.switch.aria': 'Basculer l’interface en {language}',

  /* --- search -------------------------------------------------------- */
  'search.placeholder': 'Rechercher parmi {n} apps .dot par nom ou description',
  'search.aria': 'Recherche dans chaque nom .dot indexé, nom affiché et description',
  'search.clear': 'Effacer la recherche',

  /* --- headline pair ------------------------------------------------- */
  'hero.line':
    'apps indexées · {published} publiées · {deployed} déployées · {declared} déclarant un contrat · {updated}',
  'hero.updated': 'mis à jour {ago}',
  'hero.rpcDown': 'rpc injoignable',
  'hero.rpcFallback':
    'premier rpc hors service · lecture via {host}, endpoint {using} sur {total}',
  'reg.title': 'Enregistrements',
  'reg.note':
    'une cellule par heure UTC · une ligne par jour UTC · total du jour dans la colonne de droite',
  'reg.legend': 'noms enregistrés',

  /* --- facets -------------------------------------------------------- */
  'facets.aria': 'Filtrer l’index selon ce qui existe sur la chaîne',
  'facet.all': 'Toutes',
  'facet.published': 'Publiées',
  'facet.deployed': 'Déployées',
  'facet.name': 'Nom seul',
  'facet.declared': 'Déclarent un contrat',
  'facet.new': 'Nouvelles du jour',
  'facet.unreachable': 'Injoignables',

  /* --- the index ----------------------------------------------------- */
  'idx.count.search':
    '{shown} noms sur {all} correspondent à “{q}” — la recherche couvre tout l’index, pas le filtre sélectionné.',
  'idx.count.plain':
    '{n} noms · classés par ce qui existe sur la chaîne, puis du plus récent',
  'idx.empty.search':
    'Aucun nom, nom affiché ou description de l’index ne contient “{q}”.',
  'idx.empty.filter': 'Aucun nom de l’index ne correspond encore à ce filtre.',

  /* --- tiers --------------------------------------------------------- */
  'tier.0': 'publiée',
  'tier.1': 'déployée',
  'tier.2': 'nom seul',
  'tier.reason.0.hash':
    'Publiée — un record manifest sur le content resolver la nomme et la décrit, et un contenthash pointe vers le bundle déployé.',
  'tier.reason.0.nohash':
    'Publiée — un record manifest la nomme et la décrit, mais il n’y a pas de contenthash : rien n’est encore déployé derrière le nom.',
  'tier.reason.1':
    'Déployée — un contenthash pointe vers un bundle, mais aucun record manifest ne le décrit : le nom et le bundle sont tout ce que la chaîne nous dit.',
  'tier.reason.2': 'Aucun contenthash — nom enregistré, rien de déployé.',

  /* --- index row ----------------------------------------------------- */
  'row.registered': 'enregistré {ago}',
  'row.beforeRange': 'avant l’intervalle indexé',
  'row.noManifest': 'Aucun record manifest — la chaîne ne décrit pas ce nom.',
  'row.reading': 'lecture…',
  'row.events': 'événements · {blocks} derniers blocs (~{minutes} min)',
  'row.events.one': 'événement · {blocks} derniers blocs (~{minutes} min)',
  'row.events.aria':
    '{events} événements de contrat depuis l’adresse que {name} déclare, sur les {blocks} derniers blocs (environ {minutes} minutes)',

  /* --- bundle liveness ------------------------------------------------ */
  'live.unreachable': 'bundle injoignable · {days} jours',
  'live.unreachable.one': 'bundle injoignable · 1 jour',
  'live.unreachable.today': 'bundle injoignable · depuis aujourd’hui',
  'live.never': 'bundle jamais vu par notre gateway',

  /* --- expanded detail ----------------------------------------------- */
  'detail.owner': 'Propriétaire',
  'detail.owner.none': 'non enregistré dans ce snapshot',
  'detail.contenthash': 'Contenthash',
  'detail.contenthash.none': 'aucun',
  'detail.executable': 'Record executable',
  'detail.executable.yes': 'présent sur app.{id}.dot',
  'detail.executable.no': 'absent sur app.{id}.dot',
  'detail.registered': 'Enregistré',
  'detail.contract': 'Contrat déclaré',
  'detail.contract.none': 'aucun — ce nom ne publie aucun record contract',
  'detail.open': 'Ouvrir {domain} ↗',
  'feed.recent': 'récent',

  /* --- what dotmetrics reads itself ---------------------------------- */
  'ours.title': 'Lu par dotmetrics',
  'ours.note':
    'dotmetrics code en dur l’ABI du contrat de cette app : ce sont donc nos lectures à nous — notre instrumentation, pas quelque chose que l’app a publié, et cela n’entre ni dans son classement ni dans son ordre.',

  /* --- our copy for the four apps we read contracts for --------------- */
  'app.tagline.openpetition':
    'Des pétitions signées par de vraies personnes — une signature par personne.',
  'app.tagline.thebutton': 'Un bouton, une pression par être humain, à jamais.',
  'app.tagline.truereviews': 'Une personne vérifiée, un avis par lieu.',
  'app.tagline.discreetly':
    'Des réservations privées pour de vraies personnes — anonymes, à l’épreuve des sybils, sous séquestre.',
  'app.tagline.generic': 'Enregistré sur le réseau .dot.',

  /* --- metric labels, beside the measured figures --------------------- */
  'metric.petitions': 'pétitions',
  'metric.verifiedSignatures': 'signatures vérifiées',
  'metric.unverified': 'non vérifiées',
  'metric.placesReviewed': 'lieux évalués',
  'metric.servicesListed': 'services listés',
  'metric.bookings': 'réservations',
  'metric.presses': 'pressions',
  'metric.humansRegistered': 'personnes au registre',

  /* --- chat ---------------------------------------------------------- */
  'chat.idle': 'Chat',
  'chat.busy': '…',
  'chat.outside': 'Le chat vit à l’intérieur de l’app Polkadot',
  'chat.failed': 'Chat indisponible pour le moment',
  'chat.registered': 'Salon ajouté — ouvrez l’onglet Chat',
  'chat.opened': 'Ouvert dans le chat ✓',

  /* --- chain vitals -------------------------------------------------- */
  'vitals.title': 'Constantes vitales de la chaîne',
  'vitals.note': 'à l’échelle de la chaîne, pas par app · mesuré {ago} à la hauteur #{head}',
  'vitals.legend.reverted': 'annulés',
  'vitals.legend.emitted': 'émis',

  /* --- method -------------------------------------------------------- */
  'method.summary': 'Méthode — comment ces noms ont été trouvés, et ce qui a été écarté',
  'method.p1':
    'Les noms sont découverts en parcourant les blocs d’Asset Hub — le registre ne peut pas être énuméré par un appel au contrat, le texte en clair provient donc de la calldata d’enregistrement. Ce qui est réel est ici : quand chaque nom a été enregistré, quels records il publie, et les événements des contrats mesurés en direct sur une fenêtre déclarée. L’usage par app n’est attribuable que là où un nom déclare quelle adresse est la sienne, car sur la chaîne rien ne lie les deux de soi-même — voir le dernier paragraphe.',
  'method.p2':
    'Une séquence ascii dans la calldata est un indice, pas un nom. Ce balayage a proposé {scanned} étiquettes ; {rejected} d’entre elles ont renvoyé un propriétaire nul depuis {call} et n’étaient pas du tout des enregistrements, il reste donc {kept} noms. Les étiquettes écartées sont listées plutôt que discrètement supprimées, car l’écart entre les deux chiffres est la différence entre ce qu’un balayage d’octets parvient à voir et ce que le registre contient vraiment :',
  'method.excluded.none': 'aucune dans ce snapshot',
  'method.p3':
    'Les records sont lus directement depuis le content resolver à {resolver}, jamais en suivant {lookup} — qui renvoie sur cette devnet un resolver mort, dont les {text} et {contenthash} échouent pour chaque nom. La propriété provient du registre à {registry}.',
  'method.p4':
    'Les constantes vitales de la chaîne comptent {event} sur les {blocks} derniers blocs (~{minutes} min). Sur la chaîne, rien ne lie une adresse à un nom : ce total concerne donc tout l’écosystème ; un nom qui déclare un record {record} voit le compte de sa propre adresse sur sa ligne, depuis cette même fenêtre. Les adresses les plus actives dans cette fenêtre :',
  'method.top.item': '{address} — {events} événements sur {total}',
  'method.top.none': 'aucun contrat n’a émis d’événement dans la fenêtre mesurée',
  'method.p5':
    'Ce qui a changé. Une version antérieure de cette page classait les apps selon un niveau que seul l’opérateur de l’index pouvait atteindre : la première place était « données en direct », et elle revenait aux quatre apps dont dotmetrics avait codé l’ABI du contrat à la main — toutes les quatre les nôtres. C’était annoncé ici, ce qui ne le rendait pas équitable, et cela brisait la règle pour laquelle les niveaux existent : un niveau doit énoncer un fait sur l’app, et celui-là énonçait un fait sur notre code. Le classement repose désormais sur des faits que n’importe qui peut satisfaire — un record manifest, un contenthash, un nom enregistré — et n’importe quelle app peut être mesurée sur sa propre ligne en publiant l’adresse de son contrat dans un record de texte : {cmd}. Son nombre de {event} sur la fenêtre ci-dessus apparaît alors à côté d’elle, la même métrique et les mêmes mots que pour tout le monde. Aujourd’hui, {declared} noms indexés sur {all} en déclarent un. C’est une convention propre à dotmetrics et non un standard de la plateforme : aucun champ du manifest n’existe pour une adresse de contrat, nous lisons donc un record à la place. Les quatre apps pour lesquelles nous codons un lecteur en dur rapportent toujours ces chiffres, désormais étiquetés comme notre instrumentation et ne comptant pour rien dans l’ordre.',
  'method.p6':
    'Vitalité. Le stockage de Bulletin est une fenêtre, pas un pour toujours : chaque nom porteur d’un contenthash est donc sondé à travers un seul gateway, {gateway} — et à travers aucun autre. « Injoignable » signifie donc exactement ceci : ce gateway n’a pas servi le bundle quand nous le lui avons demandé. C’est une preuve sur une seule porte du réseau, jamais la preuve que les données en ont disparu. Si plus de la moitié des bundles vus vivants la fois précédente devient injoignable en une seule exécution, l’exécution est traitée comme une panne du gateway et rien n’est enregistré : un index ne doit pas déclarer un écosystème mort parce qu’un endpoint a eu une mauvaise minute. Les noms qui ne publient aucun contenthash ne sont pas sondés du tout : il n’y a rien à atteindre derrière le nom, ils ne peuvent donc être ni vivants ni injoignables.',

  /* --- footer -------------------------------------------------------- */
  'foot.prov.record': 'index en direct via le record directory · {cid}',
  'foot.prov.pinned': 'index depuis le CID épinglé dans cette build · {cid}',
  'foot.prov.baked':
    'index depuis le snapshot intégré à cette build — Bulletin injoignable',
  'foot.note':
    'Chaque chiffre est lu en direct depuis Polkadot devnet Asset Hub via un RPC Ethereum public — aucun wallet, aucune connexion, aucune preuve d’identité. Réseau de test : les tokens n’ont aucune valeur.',

  /* --- relative time ------------------------------------------------- */
  'ago.none': '—',
  'ago.now': 'à l’instant',
  'ago.s': 'il y a {n}s',
  'ago.m': 'il y a {n}min',
  'ago.h1': 'il y a 1h',
  'ago.h': 'il y a {n}h',
  'ago.d': 'il y a {n}j',

  /* --- pulse strip --------------------------------------------------- */
  'pulse.dead': 'aucun flux de blocs',
  'pulse.waiting': 'en attente de blocs',
  'pulse.stalled': 'arrêté depuis {n}s',
  'pulse.head': '#{head}',
  'pulse.head.avg': '#{head} · {avg}s en moyenne',
  'pulse.aria.dead': 'Pouls des blocs : le flux de blocs n’a pas pu être atteint',
  'pulse.aria.waiting': 'Pouls des blocs : aucun bloc reçu pour l’instant',
  'pulse.aria.stalled':
    'Pouls des blocs arrêté : aucun nouveau bloc depuis {n} secondes, le dernier était {head}',
  'pulse.aria.ok': 'Pouls des blocs : hauteur {head}',
  'pulse.aria.ok.avg':
    'Pouls des blocs : hauteur {head}, intervalle moyen de {avg} secondes sur les {n} derniers blocs',

  /* --- registration heatmap ------------------------------------------ */
  'heat.aria.empty':
    'Carte de chaleur des enregistrements : aucun enregistrement dans l’intervalle indexé',
  'heat.aria':
    'Carte de chaleur des enregistrements : {total} enregistrements sur {days} jours UTC, pic de {max} en une heure. Les flèches déplacent d’une cellule à l’autre.',
  'heat.empty':
    '0 enregistrement dans l’intervalle indexé — la grille se remplit à mesure que les noms arrivent.',
  'heat.utc': 'UTC',
  'heat.tip.one': '1 nom enregistré',
  'heat.tip.n': '{n} noms enregistrés',
  'heat.tip.when': '{day}, {hour}h00 UTC',
  'heat.tip.more': '+{n} autres',

  /* --- step sparkline ------------------------------------------------ */
  'spark.aria': 'Enregistrements cumulés, de {first} à {last}, jusqu’à {n}',
  'spark.aria.empty':
    'Enregistrements cumulés : moins de deux enregistrements datés, rien à tracer',

  /* --- chain vitals readouts ----------------------------------------- */
  'vitals.aria':
    'Issue des appels sur les {blocks} derniers blocs : {reverts} annulés et {events} émis, sur {calls} appels',
  'vitals.aria.none': 'Issue des appels : pas encore mesurée',
  'vitals.measuring': 'mesure…',
  'vitals.blockTime': 'blocs de {s}s',
  'vitals.blockTime.sub': '{blocks} blocs en {secs}s (~{minutes} min)',
  'vitals.blockTime.none': 'aucune fenêtre encore mesurée',
  'vitals.events': '{n} événements / 1k blocs',
  'vitals.events.sub.one': '{events} événements depuis 1 contrat · {blocks} derniers blocs',
  'vitals.events.sub':
    '{events} événements depuis {contracts} contrats · {blocks} derniers blocs',
  'vitals.events.none': 'aucun événement encore compté',
  'vitals.reverts': '{pct}% annulés',
  'vitals.reverts.sub':
    '{reverts} appels sur {calls} · {blocks} derniers blocs (~{minutes} min)',
  'vitals.reverts.none': 'aucun appel vu dans la fenêtre',
  'vitals.tip.calls': '{calls} appels aux contrats sur {blocks} blocs',
  'vitals.tip.split': '{reverts} annulés · {events} émis',
  'vitals.tip.busiest': 'la plus active {address} · {events} événements sur {total}',
  'vitals.tip.head': 'mesuré à la hauteur #{head}',

  /* --- third-party descriptions -------------------------------------- */
  'desc.marker.aria': 'Cette description est écrite en {language}',
  'desc.translate': 'traduire',
  'desc.translate.aria': 'Traduire automatiquement cette description en {language}',
  'desc.translating': 'traduction…',
  'desc.mt': 'Traduction automatique',
  'desc.mt.via': '{from} → {to} via {service} · ce ne sont pas les mots de l’auteur',
  'desc.original': 'afficher l’original',
  'desc.error': 'Échec de la traduction — {reason}',
  'desc.retry': 'réessayer',

  /* --- language names ------------------------------------------------ */
  'lang.name.en': 'anglais',
  'lang.name.it': 'italien',
  'lang.name.fr': 'français',
  'lang.name.es': 'espagnol',
  'lang.name.de': 'allemand',
  'lang.name.pt': 'portugais',
  'lang.name.nl': 'néerlandais',
  'lang.name.zh': 'chinois',
  'lang.name.ja': 'japonais',
  'lang.name.ko': 'coréen',
  'lang.name.ru': 'russe',
  'lang.name.ar': 'arabe',
  'lang.name.el': 'grec',
  'lang.name.he': 'hébreu',
  'lang.name.hi': 'hindi',

  /* --- translation failure reasons ----------------------------------- */
  'tr.err.offline': 'l’appareil est hors ligne',
  'tr.err.http': 'le service de traduction a répondu HTTP {status}',
  'tr.err.empty': 'le service de traduction a renvoyé une réponse vide',
  'tr.err.badJson': 'le service de traduction a renvoyé autre chose que du JSON',
  'tr.err.timeout': 'le service de traduction n’a pas répondu à temps',
  'tr.err.network': 'le service de traduction n’a pas pu être atteint',
  'tr.err.tooLong': 'cette description fait {n} caractères et le service en accepte {max}',
  'tr.err.quota': 'le quota quotidien gratuit pour ce réseau est épuisé',
  'tr.err.service': '{detail}',
};

const DICT: Record<Lang, Record<MsgKey, string>> = { en: EN, it: IT, es: ES, fr: FR };

/* ------------------------------------------------------------ the store */

const STORAGE_KEY = 'dotmetrics.lang';

function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/**
 * Where the first language comes from, in order: an explicit choice the reader
 * made before, then the browser's own preference list, then English.
 *
 * `navigator.languages` is consulted before `navigator.language` because a
 * reader whose primary locale is, say, `de` but whose second is `it` is better
 * served in Italian than in English.
 *
 * REGION SUBTAGS ARE DROPPED, and that is the whole reason this matches on a
 * base tag rather than the full string: `es-MX` and `es-419` are Spanish,
 * `fr-CA` and `fr-BE` are French, `it-CH` is Italian, `en-GB` is English. A
 * reader in Mexico City must not be handed English because nobody wrote a
 * dictionary called `es-MX`. Number and date formatting is a separate question
 * with a separate answer — see {@link LOCALE}, which pins one canonical locale
 * per language so a figure never renders one way for a Mexican reader and
 * another for a Spaniard.
 */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Private mode or a storage-less shell — fall through to the browser.
  }
  const prefs =
    typeof navigator !== 'undefined'
      ? [...(navigator.languages ?? []), navigator.language ?? '']
      : [];
  for (const tag of prefs) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

function announce(): void {
  // Keep the document in sync so screen readers and `:lang()` agree with the UI.
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  for (const fn of listeners) fn();
}
announce();

export function getLang(): Lang {
  return current;
}

/** Set the interface language and remember it. */
export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A refused write must not stop the language from changing for this session.
  }
  announce();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Subscribe a component to the current language. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/* ------------------------------------------------------------ formatting */

const LOCALE: Record<Lang, string> = {
  en: 'en-US',
  it: 'it-IT',
  es: 'es-ES',
  fr: 'fr-FR',
};

/** BCP 47 tag for `toLocaleString` and friends. */
export function locale(lang: Lang = current): string {
  return LOCALE[lang];
}

export type Vars = Record<string, string | number>;

function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    // An unknown placeholder stays visible as `{name}` rather than becoming an
    // empty gap: a broken string should look broken, not merely odd.
    name in vars ? String(vars[name]) : whole,
  );
}

/** Translate `key` into the current language, filling `{placeholders}`. */
export function t(key: MsgKey, vars?: Vars): string {
  return fill(DICT[current][key], vars);
}

/**
 * Split a translated string into its literal text and its `{placeholders}`, so
 * a caller can drop React nodes — `<b>`, `<code>`, a link — into the gaps.
 *
 * This exists so the Method block stays ONE translatable sentence per
 * paragraph. Chopping prose into fragments around the JSX would force Italian
 * into English word order, and those paragraphs are the honest part of the
 * page; they have to read like Italian, not like a template.
 *
 * Returns `(string | T)[]`, so React callers get nodes and a plain-text caller
 * can pass strings and join the result.
 */
export function tSplit<T>(key: MsgKey, nodes: Record<string, T>): (string | T)[] {
  const out: (string | T)[] = [];
  const template = DICT[current][key];
  let last = 0;
  const re = /\{(\w+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) out.push(template.slice(last, m.index));
    const name = m[1];
    // Same rule as `fill`: an unmatched placeholder is left visible.
    out.push(name in nodes ? nodes[name] : m[0]);
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/** The display name of a detected language, in the reader's language. */
export function languageName(code: string): string {
  const key = `lang.name.${code}` as MsgKey;
  return key in DICT[current] ? DICT[current][key] : code.toUpperCase();
}
