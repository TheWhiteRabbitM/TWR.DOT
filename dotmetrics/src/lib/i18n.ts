import { useSyncExternalStore } from 'react';

/**
 * Two languages, no library.
 *
 * The bundle is already ~1.4MB; i18next and its plugins would add tens of
 * kilobytes to carry a few hundred bytes of Italian. So: one dictionary, one
 * `t()`, one subscription so React re-renders when the language flips.
 *
 * The type discipline is the whole point. `EN` is the source of truth and its
 * keys become {@link MsgKey}; `IT` is declared `Record<MsgKey, string>`, so a
 * forgotten translation is a compile error at `npm run build` and never a blank
 * label at runtime. An *extra* key in `IT` fails too — excess property checking
 * catches the key that was renamed on one side only.
 *
 * WHAT IS NOT IN HERE, deliberately: the descriptions third-party app authors
 * publish in their on-chain manifests. Those are their words, in their
 * language, and this app does not own them — see lib/detect-lang.ts and
 * lib/translate.ts for how they are marked and, only on request, translated.
 */

export const LANGS = ['en', 'it'] as const;
export type Lang = (typeof LANGS)[number];

/* ------------------------------------------------------------ dictionary */

const EN = {
  /* --- top bar ------------------------------------------------------- */
  'bar.devnet': 'devnet',
  'lang.aria': 'Interface language',
  'lang.en.aria': 'Switch the interface to English',
  'lang.it.aria': 'Switch the interface to Italian',

  /* --- search -------------------------------------------------------- */
  'search.placeholder': 'Search {n} .dot apps by name or description',
  'search.aria': 'Search every indexed .dot name, display name and description',
  'search.clear': 'Clear search',

  /* --- headline pair ------------------------------------------------- */
  'hero.line':
    'apps indexed · {published} published · {deployed} deployed · {declared} declaring a contract · {updated}',
  'hero.updated': 'updated {ago}',
  'hero.rpcDown': 'rpc unreachable',
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
  'lang.en.aria': 'Passa l’interfaccia all’inglese',
  'lang.it.aria': 'Passa l’interfaccia all’italiano',

  /* --- search -------------------------------------------------------- */
  'search.placeholder': 'Cerca fra {n} app .dot per nome o descrizione',
  'search.aria': 'Cerca in ogni nome .dot indicizzato, nome visualizzato e descrizione',
  'search.clear': 'Cancella la ricerca',

  /* --- headline pair ------------------------------------------------- */
  'hero.line':
    'app indicizzate · {published} pubblicate · {deployed} distribuite · {declared} che dichiarano un contratto · {updated}',
  'hero.updated': 'aggiornato {ago}',
  'hero.rpcDown': 'rpc irraggiungibile',
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

const DICT: Record<Lang, Record<MsgKey, string>> = { en: EN, it: IT };

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
 * served in Italian than in English. Region subtags are ignored: `it-CH` is
 * Italian.
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

const LOCALE: Record<Lang, string> = { en: 'en-US', it: 'it-IT' };

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
