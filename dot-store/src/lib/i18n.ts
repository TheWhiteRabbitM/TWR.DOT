import { useEffect, useState } from 'react';

/**
 * Four languages, typed so a missing translation is a compile error rather than
 * a blank space in the shop window. No i18n library: this is a dictionary and a
 * lookup, and a dependency would weigh more than the whole file.
 */
export const LANGS = ['en', 'it', 'es', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

const EN = {
  'nav.apps': 'Apps',
  'app.tagline': 'Every app registered on the Polkadot devnet, read from the chain on each visit.',
  'nav.devnet': 'devnet',
  'search.ph': 'Search apps',
  'search.aria': 'Search apps by name, description or owner',
  'search.results': '{n} results',
  'search.empty': 'No app matches “{q}”.',
  'appearance.aria': 'Appearance',
  'appearance.auto': 'Auto',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'shelf.featured': 'Featured',
  'shelf.featured.sub': 'Apps we could render — a real screenshot, not a mock-up',
  'shelf.new': 'New on the devnet',
  'shelf.new.sub': 'The most recently registered names',
  'shelf.top': 'Top rated',
  'shelf.top.sub': 'Ranked by the reviews held in the contract',
  'shelf.all': 'All apps',
  'shelf.all.sub': '{n} names registered on chain',
  'shelf.seeall': 'See All',
  'kicker.featured': 'featured',
  'kicker.new': 'new',
  'open': 'Open',
  'open.aria': 'Open {name} in the Polkadot app',
  'tier.0': 'Published',
  'tier.1': 'Deployed',
  'tier.2': 'Name only',
  'nodesc': 'No description published.',
  'rating.none': 'No reviews yet',
  'rating.one': '{avg} · 1 review',
  'rating.n': '{avg} · {n} reviews',
  'back': 'Apps',
  'meta.ratings': 'Ratings',
  'meta.noratings': 'No Ratings',
  'meta.status': 'Status',
  'meta.registered': 'Registered',
  'meta.developer': 'Developer',
  'meta.unknown': 'Unknown',
  'gallery.h': 'Preview',
  'gallery.none': 'No screenshot captured yet.',
  'about.h': 'About this app',
  'more': 'more',
  'reviews.h': 'Ratings & Reviews',
  'reviews.outof': 'out of 5',
  'reviews.count': '{n} Ratings',
  'reviews.loading': 'Reading reviews from the contract…',
  'reviews.none': 'No reviews yet. Be the first.',
  'reviews.unverified': 'unverified · devnet',
  'reviews.verified': 'verified human',
  'write.h': 'Write a review',
  'write.rating': 'Your rating',
  'write.ph': 'What is it like to use? (280 characters)',
  'write.send': 'Post review',
  'write.sending': 'Posting…',
  'write.need.rating': 'Pick a rating first.',
  'write.demo': 'Saved on this device only — not on chain. Reviews are signed inside the Polkadot app.',
  'write.done': 'Posted on chain ✓',
  'write.failed': 'Could not post: {why}',
  'write.already': 'You have already reviewed this app.',
  'write.signing': 'Waiting for your signature…',
  'write.step': '{step}…',
  'info.h': 'Information',
  'info.domain': 'Domain',
  'info.owner': 'Owner',
  'info.bundle': 'Bundle',
  'info.contract': 'Reviews contract',
  'info.registered': 'Registered',
  'info.none': '—',
  'chain.open': 'Reviews are open on this devnet: anyone can post, and a review counts one wallet — not one human. On the live network the contract requires proof of personhood.',
  'chain.reviewed': '{n} apps reviewed on chain',
  'chain.off': 'The reviews contract did not answer. Ratings are unavailable right now.',
  'foot.metrics': 'The numbers behind this store: dotmetrics.dot',
  'foot.chat': 'Community chat',
  'foot.devnet': 'Devnet — tokens carry no value, and stored apps expire unless renewed.',
  'demo.local': 'your review, on this device',
  'shot.owner': 'Screenshot supplied by the app’s developer.',
  'shot.captured': 'Screenshot captured automatically by dot-store.',
  'dev.h': 'Are you the developer of one of these apps?',
  'dev.body':
    'You do not need an account here. The store reads the chain, and the key that owns your name is the only authorisation needed — a write to a name you do not own is rejected by the registry.',
  'dev.desc': 'To set the name, description and icon shown on your card:',
  'dev.shots': 'To supply your own screenshots, upload them to Bulletin and declare the CIDs:',
  'dev.note':
    'Both records are picked up on the next hourly run. Bulletin keeps data for about two weeks, so re-publish your images to keep them alive — if a CID lapses, the store falls back to its own capture.',
} as const;

export type MsgKey = keyof typeof EN;
type Dict = Record<MsgKey, string>;

const IT: Dict = {
  'nav.apps': 'App',
  'app.tagline': 'Tutte le app registrate sulla devnet Polkadot, lette dalla catena a ogni visita.',
  'nav.devnet': 'devnet',
  'search.ph': 'Cerca app',
  'search.aria': 'Cerca app per nome, descrizione o proprietario',
  'search.results': '{n} risultati',
  'search.empty': 'Nessuna app corrisponde a “{q}”.',
  'appearance.aria': 'Aspetto',
  'appearance.auto': 'Auto',
  'appearance.light': 'Chiaro',
  'appearance.dark': 'Scuro',
  'shelf.featured': 'In evidenza',
  'shelf.featured.sub': 'Le app che riusciamo a mostrare — screenshot reali, non finti',
  'shelf.new': 'Nuove sulla devnet',
  'shelf.new.sub': 'I nomi registrati più di recente',
  'shelf.top': 'Più apprezzate',
  'shelf.top.sub': 'In ordine secondo le recensioni contenute nel contratto',
  'shelf.all': 'Tutte le app',
  'shelf.all.sub': '{n} nomi registrati sulla catena',
  'shelf.seeall': 'Vedi tutte',
  'kicker.featured': 'in evidenza',
  'kicker.new': 'nuova',
  'open': 'Apri',
  'open.aria': 'Apri {name} nella Polkadot app',
  'tier.0': 'Pubblicata',
  'tier.1': 'Distribuita',
  'tier.2': 'Solo nome',
  'nodesc': 'Nessuna descrizione pubblicata.',
  'rating.none': 'Ancora nessuna recensione',
  'rating.one': '{avg} · 1 recensione',
  'rating.n': '{avg} · {n} recensioni',
  'back': 'App',
  'meta.ratings': 'Voti',
  'meta.noratings': 'Nessun voto',
  'meta.status': 'Stato',
  'meta.registered': 'Registrata',
  'meta.developer': 'Sviluppatore',
  'meta.unknown': 'Sconosciuto',
  'gallery.h': 'Anteprima',
  'gallery.none': 'Nessuno screenshot ancora catturato.',
  'about.h': 'Informazioni sull’app',
  'more': 'altro',
  'reviews.h': 'Voti e recensioni',
  'reviews.outof': 'su 5',
  'reviews.count': '{n} voti',
  'reviews.loading': 'Lettura delle recensioni dal contratto…',
  'reviews.none': 'Ancora nessuna recensione. Puoi essere il primo.',
  'reviews.unverified': 'non verificata · devnet',
  'reviews.verified': 'persona verificata',
  'write.h': 'Scrivi una recensione',
  'write.rating': 'Il tuo voto',
  'write.ph': "Com'è usarla? (280 caratteri)",
  'write.send': 'Pubblica',
  'write.sending': 'Pubblicazione…',
  'write.need.rating': 'Scegli prima un voto.',
  'write.demo': 'Salvata solo su questo dispositivo — non sulla catena. Le recensioni si firmano dentro la Polkadot app.',
  'write.done': 'Pubblicata sulla catena ✓',
  'write.failed': 'Pubblicazione non riuscita: {why}',
  'write.already': 'Hai già recensito questa app.',
  'write.signing': 'In attesa della tua firma…',
  'write.step': '{step}…',
  'info.h': 'Informazioni',
  'info.domain': 'Dominio',
  'info.owner': 'Proprietario',
  'info.bundle': 'Bundle',
  'info.contract': 'Contratto recensioni',
  'info.registered': 'Registrata',
  'info.none': '—',
  'chain.open': 'Su questa devnet le recensioni sono aperte: chiunque può scriverne, e una recensione vale un portafoglio — non una persona. Sulla rete vera il contratto richiede la prova di personhood.',
  'chain.reviewed': '{n} app recensite sulla catena',
  'chain.off': 'Il contratto delle recensioni non ha risposto. I voti non sono disponibili ora.',
  'foot.metrics': 'I numeri dietro questo store: dotmetrics.dot',
  'foot.chat': 'Chat della community',
  'foot.devnet': 'Devnet — i token non hanno valore, e le app archiviate scadono se non rinnovate.',
  'demo.local': 'la tua recensione, su questo dispositivo',
  'shot.owner': 'Screenshot fornito dallo sviluppatore dell’app.',
  'shot.captured': 'Screenshot catturato automaticamente da dot-store.',
  'dev.h': 'Sei lo sviluppatore di una di queste app?',
  'dev.body':
    'Qui non ti serve nessun account. Lo store legge la catena, e la chiave che possiede il tuo nome è l’unica autorizzazione necessaria — una scrittura su un nome che non è tuo viene rifiutata dal registry.',
  'dev.desc': 'Per impostare nome, descrizione e icona mostrati sulla tua card:',
  'dev.shots': 'Per fornire i tuoi screenshot, caricali su Bulletin e dichiara i CID:',
  'dev.note':
    'Entrambi i record vengono letti al giro successivo, ogni ora. Bulletin conserva i dati per circa due settimane: ripubblica le immagini per tenerle in vita — se un CID scade, lo store ricade sulla propria cattura.',
};

const ES: Dict = {
  'nav.apps': 'Apps',
  'app.tagline': 'Todas las apps registradas en la devnet de Polkadot, leídas de la cadena en cada visita.',
  'nav.devnet': 'devnet',
  'search.ph': 'Buscar apps',
  'search.aria': 'Buscar apps por nombre, descripción o propietario',
  'search.results': '{n} resultados',
  'search.empty': 'Ninguna app coincide con «{q}».',
  'appearance.aria': 'Aspecto',
  'appearance.auto': 'Auto',
  'appearance.light': 'Claro',
  'appearance.dark': 'Oscuro',
  'shelf.featured': 'Destacadas',
  'shelf.featured.sub': 'Las apps que logramos mostrar — capturas reales, no simuladas',
  'shelf.new': 'Nuevas en la devnet',
  'shelf.new.sub': 'Los nombres registrados más recientemente',
  'shelf.top': 'Mejor valoradas',
  'shelf.top.sub': 'Ordenadas según las reseñas que guarda el contrato',
  'shelf.all': 'Todas las apps',
  'shelf.all.sub': '{n} nombres registrados en la cadena',
  'shelf.seeall': 'Ver todas',
  'kicker.featured': 'destacada',
  'kicker.new': 'nueva',
  'open': 'Abrir',
  'open.aria': 'Abrir {name} en la app de Polkadot',
  'tier.0': 'Publicada',
  'tier.1': 'Desplegada',
  'tier.2': 'Solo nombre',
  'nodesc': 'Sin descripción publicada.',
  'rating.none': 'Aún sin reseñas',
  'rating.one': '{avg} · 1 reseña',
  'rating.n': '{avg} · {n} reseñas',
  'back': 'Apps',
  'meta.ratings': 'Valoraciones',
  'meta.noratings': 'Sin valoraciones',
  'meta.status': 'Estado',
  'meta.registered': 'Registrada',
  'meta.developer': 'Desarrollador',
  'meta.unknown': 'Desconocido',
  'gallery.h': 'Vista previa',
  'gallery.none': 'Aún no se ha capturado ninguna captura.',
  'about.h': 'Acerca de esta app',
  'more': 'más',
  'reviews.h': 'Valoraciones y reseñas',
  'reviews.outof': 'de 5',
  'reviews.count': '{n} valoraciones',
  'reviews.loading': 'Leyendo las reseñas del contrato…',
  'reviews.none': 'Aún sin reseñas. Sé el primero.',
  'reviews.unverified': 'sin verificar · devnet',
  'reviews.verified': 'persona verificada',
  'write.h': 'Escribe una reseña',
  'write.rating': 'Tu valoración',
  'write.ph': '¿Cómo es usarla? (280 caracteres)',
  'write.send': 'Publicar',
  'write.sending': 'Publicando…',
  'write.need.rating': 'Elige primero una valoración.',
  'write.demo': 'Guardada solo en este dispositivo — no en la cadena. Las reseñas se firman dentro de la app de Polkadot.',
  'write.done': 'Publicada en la cadena ✓',
  'write.failed': 'No se pudo publicar: {why}',
  'write.already': 'Ya has reseñado esta app.',
  'write.signing': 'Esperando tu firma…',
  'write.step': '{step}…',
  'info.h': 'Información',
  'info.domain': 'Dominio',
  'info.owner': 'Propietario',
  'info.bundle': 'Bundle',
  'info.contract': 'Contrato de reseñas',
  'info.registered': 'Registrada',
  'info.none': '—',
  'chain.open': 'En esta devnet las reseñas están abiertas: cualquiera puede escribir, y una reseña cuenta una cartera — no una persona. En la red real el contrato exige prueba de personhood.',
  'chain.reviewed': '{n} apps reseñadas en la cadena',
  'chain.off': 'El contrato de reseñas no respondió. Las valoraciones no están disponibles ahora.',
  'foot.metrics': 'Los números detrás de esta tienda: dotmetrics.dot',
  'foot.chat': 'Chat de la comunidad',
  'foot.devnet': 'Devnet — los tokens no tienen valor, y las apps almacenadas caducan si no se renuevan.',
  'demo.local': 'tu reseña, en este dispositivo',
  'shot.owner': 'Captura facilitada por el desarrollador de la app.',
  'shot.captured': 'Captura tomada automáticamente por dot-store.',
  'dev.h': '¿Eres el desarrollador de una de estas apps?',
  'dev.body':
    'Aquí no necesitas ninguna cuenta. La tienda lee la cadena, y la clave que posee tu nombre es la única autorización necesaria — una escritura en un nombre que no es tuyo la rechaza el registry.',
  'dev.desc': 'Para fijar el nombre, la descripción y el icono de tu tarjeta:',
  'dev.shots': 'Para aportar tus propias capturas, súbelas a Bulletin y declara los CID:',
  'dev.note':
    'Ambos registros se leen en la siguiente pasada horaria. Bulletin conserva los datos unas dos semanas: vuelve a publicar tus imágenes para mantenerlas vivas — si un CID caduca, la tienda recurre a su propia captura.',
};

const FR: Dict = {
  'nav.apps': 'Apps',
  'app.tagline': 'Toutes les apps enregistrées sur le devnet Polkadot, lues sur la chaîne à chaque visite.',
  'nav.devnet': 'devnet',
  'search.ph': 'Rechercher des apps',
  'search.aria': 'Rechercher par nom, description ou propriétaire',
  'search.results': '{n} résultats',
  'search.empty': 'Aucune app ne correspond à « {q} ».',
  'appearance.aria': 'Apparence',
  'appearance.auto': 'Auto',
  'appearance.light': 'Clair',
  'appearance.dark': 'Sombre',
  'shelf.featured': 'À la une',
  'shelf.featured.sub': "Les apps que nous arrivons à afficher — de vraies captures, pas des maquettes",
  'shelf.new': 'Nouveautés du devnet',
  'shelf.new.sub': 'Les noms enregistrés le plus récemment',
  'shelf.top': 'Les mieux notées',
  'shelf.top.sub': 'Classées selon les avis conservés par le contrat',
  'shelf.all': 'Toutes les apps',
  'shelf.all.sub': '{n} noms enregistrés sur la chaîne',
  'shelf.seeall': 'Tout voir',
  'kicker.featured': 'à la une',
  'kicker.new': 'nouveau',
  'open': 'Ouvrir',
  'open.aria': 'Ouvrir {name} dans l’app Polkadot',
  'tier.0': 'Publiée',
  'tier.1': 'Déployée',
  'tier.2': 'Nom seul',
  'nodesc': 'Aucune description publiée.',
  'rating.none': 'Pas encore d’avis',
  'rating.one': '{avg} · 1 avis',
  'rating.n': '{avg} · {n} avis',
  'back': 'Apps',
  'meta.ratings': 'Notes',
  'meta.noratings': 'Aucune note',
  'meta.status': 'État',
  'meta.registered': 'Enregistrée',
  'meta.developer': 'Développeur',
  'meta.unknown': 'Inconnu',
  'gallery.h': 'Aperçu',
  'gallery.none': 'Aucune capture pour le moment.',
  'about.h': 'À propos de cette app',
  'more': 'plus',
  'reviews.h': 'Notes et avis',
  'reviews.outof': 'sur 5',
  'reviews.count': '{n} notes',
  'reviews.loading': 'Lecture des avis depuis le contrat…',
  'reviews.none': 'Pas encore d’avis. Soyez le premier.',
  'reviews.unverified': 'non vérifié · devnet',
  'reviews.verified': 'personne vérifiée',
  'write.h': 'Écrire un avis',
  'write.rating': 'Votre note',
  'write.ph': 'Comment est-ce à l’usage ? (280 caractères)',
  'write.send': 'Publier',
  'write.sending': 'Publication…',
  'write.need.rating': 'Choisissez d’abord une note.',
  'write.demo': 'Enregistré sur cet appareil uniquement — pas sur la chaîne. Les avis se signent dans l’app Polkadot.',
  'write.done': 'Publié sur la chaîne ✓',
  'write.failed': 'Publication impossible : {why}',
  'write.already': 'Vous avez déjà donné un avis sur cette app.',
  'write.signing': 'En attente de votre signature…',
  'write.step': '{step}…',
  'info.h': 'Informations',
  'info.domain': 'Domaine',
  'info.owner': 'Propriétaire',
  'info.bundle': 'Bundle',
  'info.contract': 'Contrat des avis',
  'info.registered': 'Enregistrée',
  'info.none': '—',
  'chain.open': 'Sur ce devnet les avis sont ouverts : n’importe qui peut écrire, et un avis compte un portefeuille — pas une personne. Sur le réseau réel le contrat exige une preuve de personhood.',
  'chain.reviewed': '{n} apps évaluées sur la chaîne',
  'chain.off': 'Le contrat des avis n’a pas répondu. Les notes sont indisponibles.',
  'foot.metrics': 'Les chiffres derrière cette boutique : dotmetrics.dot',
  'foot.chat': 'Chat de la communauté',
  'foot.devnet': 'Devnet — les jetons n’ont aucune valeur, et les apps stockées expirent sans renouvellement.',
  'demo.local': 'votre avis, sur cet appareil',
  'shot.owner': 'Capture fournie par le développeur de l’app.',
  'shot.captured': 'Capture réalisée automatiquement par dot-store.',
  'dev.h': 'Vous développez l’une de ces apps ?',
  'dev.body':
    'Aucun compte n’est nécessaire ici. La boutique lit la chaîne, et la clé qui possède votre nom est la seule autorisation requise — une écriture sur un nom qui n’est pas le vôtre est refusée par le registry.',
  'dev.desc': 'Pour définir le nom, la description et l’icône de votre fiche :',
  'dev.shots': 'Pour fournir vos propres captures, envoyez-les sur Bulletin et déclarez les CID :',
  'dev.note':
    'Les deux enregistrements sont lus au passage horaire suivant. Bulletin conserve les données environ deux semaines : republiez vos images pour les maintenir en vie — si un CID expire, la boutique retombe sur sa propre capture.',
};

const DICT: Record<Lang, Dict> = { en: EN as unknown as Dict, it: IT, es: ES, fr: FR };
const KEY = 'dotstore.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  } catch {
    /* private mode */
  }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return (LANGS as readonly string[]).includes(nav) ? (nav as Lang) : 'en';
}

let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  listeners.forEach((fn) => fn(l));
}

/** Re-render on a language change without a context provider. */
export function useLang(): Lang {
  const [l, setL] = useState(current);
  useEffect(() => {
    listeners.add(setL);
    return () => {
      listeners.delete(setL);
    };
  }, []);
  return l;
}

export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  const s = DICT[current][key] ?? DICT.en[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** Intl locale for number and date formatting. */
export function locale(l: Lang = current): string {
  return { en: 'en-GB', it: 'it-IT', es: 'es-ES', fr: 'fr-FR' }[l];
}
