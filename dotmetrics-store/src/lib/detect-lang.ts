/**
 * Which language is this text in? Answered locally, with no network call.
 *
 * The descriptions this runs on are NOT ours: they are written by third-party
 * app authors and read out of their on-chain manifests. dotmetrics marks them
 * and, only if asked, translates them — so the one thing this module must never
 * do is guess loudly. A confident wrong flag ("FR" on an English sentence) is
 * worse than no flag at all, because a reader has no way to check it. Every
 * uncertain case therefore returns `null`, and the UI shows nothing.
 *
 * Two stages:
 *
 *  1. SCRIPT. Chinese, Japanese, Korean, Russian, Arabic, Greek, Hebrew and
 *     Hindi are separable by codepoint range alone. The test is on the SHARE of
 *     letters in a script, never on mere presence — one app in this index
 *     describes itself as "Bilingual (中/EN) illustrated map of the Polkadot
 *     Products Devnet…", English prose carrying a single Han character. A
 *     presence test flags that as Chinese. A share test does not.
 *
 *  2. STOPWORDS. Latin-script languages share an alphabet, so they are
 *     separated by their commonest function words plus a few near-exclusive
 *     letters. A winner must clear an absolute floor AND beat the runner-up by
 *     a margin; ties and near-ties are `null`. Short texts are `null` too:
 *     "Dashboard widgets" is not enough evidence to name a language.
 */

/** Languages this module is willing to name. */
export type DetectedLang =
  | 'en' | 'it' | 'fr' | 'es' | 'de' | 'pt' | 'nl'
  | 'zh' | 'ja' | 'ko' | 'ru' | 'ar' | 'el' | 'he' | 'hi';

/* ------------------------------------------------------------- 1. script */

/**
 * Non-Latin scripts, each a codepoint test. Order matters only for CJK, which
 * is resolved separately below.
 */
const SCRIPTS: { lang: DetectedLang; re: RegExp }[] = [
  { lang: 'ru', re: /[Ѐ-ӿ]/ }, // Cyrillic
  { lang: 'el', re: /[Ͱ-Ͽἀ-῿]/ }, // Greek
  { lang: 'ar', re: /[؀-ۿݐ-ݿ]/ }, // Arabic
  { lang: 'he', re: /[֐-׿]/ }, // Hebrew
  { lang: 'hi', re: /[ऀ-ॿ]/ }, // Devanagari
  { lang: 'ko', re: /[가-힯ᄀ-ᇿ]/ }, // Hangul
  { lang: 'ja', re: /[぀-ゟ゠-ヿ]/ }, // Kana — Japanese only
  { lang: 'zh', re: /[㐀-䶿一-鿿]/ }, // Han
];

const LATIN = /[a-zÀ-ɏ]/i;

/**
 * A non-Latin script must own this share of the letters before it names the
 * text. 0.35 is deliberately low enough to catch a Chinese sentence quoting an
 * English product name, and high enough to reject English prose containing one
 * or two CJK characters.
 */
const SCRIPT_SHARE = 0.35;

/** …and this many characters, so a two-character fragment cannot decide. */
const SCRIPT_MIN_CHARS = 4;

/* ---------------------------------------------------------- 2. stopwords */

/**
 * The commonest function words of each Latin-script language considered.
 *
 * Each list is the language's genuine high-frequency core, INCLUDING the words
 * it shares with its neighbours. Trimming the overlaps out by hand was the
 * first version of this file and it was wrong: dropping "de", "la" and "un"
 * from Spanish to avoid clashing with French meant a Spanish sentence scored
 * four French words and two Spanish ones, and the page confidently flagged
 * Spanish prose as French.
 *
 * Sharing is handled by weighting instead — see {@link WEIGHT}. A word is worth
 * `1 / (number of languages that list it)`, so "the", "les", "las" and "der"
 * are decisive while "de" and "la", which four languages share, barely move
 * anything. That is computed once, from these lists, so adding a language
 * cannot silently leave a stale weight behind.
 */
const STOPWORDS: Record<string, string[]> = {
  en: [
    'the', 'and', 'of', 'to', 'in', 'is', 'for', 'on', 'with', 'you', 'your', 'that',
    'this', 'are', 'it', 'not', 'one', 'by', 'from', 'can', 'an', 'be', 'as', 'at',
    'or', 'all', 'every', 'has', 'have', 'what', 'how', 'which', 'but', 'they',
    'their', 'no', 'any', 'each', 'into', 'out', 'up', 'about', 'more', 'than',
    'who', 'when', 'where', 'been', 'was', 'were', 'its', 'them', 'we', 'our',
  ],
  it: [
    'il', 'lo', 'la', 'gli', 'le', 'i', 'un', 'uno', 'una', 'di', 'del', 'dello',
    'della', 'dei', 'degli', 'delle', 'e', 'ed', 'che', 'non', 'per', 'con', 'su',
    'sul', 'sulla', 'sui', 'da', 'dal', 'dalla', 'come', 'più', 'sono', 'è',
    'questo', 'questa', 'ogni', 'anche', 'nel', 'nella', 'nei', 'alla', 'allo',
    'ai', 'agli', 'alle', 'tra', 'fra', 'ma', 'se', 'ha', 'hanno', 'essere',
    'senza', 'quando', 'dove', 'chi', 'loro', 'suo', 'sua', 'cui', 'già', 'in',
    'a', 'o', 'al', 'molto', 'può', 'solo', 'due',
  ],
  fr: [
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'sont',
    'pour', 'avec', 'sur', 'dans', 'par', 'que', 'qui', 'ne', 'pas', 'plus',
    'ce', 'cet', 'cette', 'ces', 'votre', 'vos', 'aux', 'au', 'ou', 'mais',
    'son', 'ses', 'leur', 'leurs', 'tout', 'tous', 'toute', 'toutes', 'comme',
    'sans', 'chaque', 'entre', 'être', 'aucun', 'aucune', 'nos', 'notre',
    'vers', 'chez', 'donc', 'où', 'quand', 'très', 'peut', 'faire', 'à', 'se',
    'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'déjà', 'sous', 'depuis', 'en',
  ],
  es: [
    'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'y', 'o', 'no',
    'es', 'son', 'se', 'su', 'sus', 'que', 'en', 'con', 'por', 'para', 'sobre',
    'más', 'como', 'pero', 'cada', 'entre', 'sin', 'ni', 'este', 'esta',
    'estos', 'estas', 'muy', 'todo', 'todos', 'toda', 'donde', 'cuando',
    'quien', 'hay', 'ser', 'está', 'lo', 'ya', 'desde', 'hasta', 'también',
    'puede', 'a',
  ],
  de: [
    'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ist', 'sind', 'für',
    'mit', 'auf', 'von', 'im', 'ein', 'eine', 'einen', 'einem', 'einer',
    'nicht', 'auch', 'oder', 'aber', 'wie', 'wird', 'werden', 'zum', 'zur',
    'bei', 'nach', 'über', 'alle', 'jede', 'jeden', 'kann', 'sich', 'nur',
    'wenn', 'als', 'aus', 'sie', 'wir', 'zu', 'ohne', 'sein', 'haben', 'man',
    'es', 'noch', 'schon',
  ],
  pt: [
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'e',
    'é', 'são', 'para', 'com', 'em', 'por', 'que', 'não', 'se', 'seu', 'sua',
    'mais', 'como', 'cada', 'entre', 'sem', 'este', 'esta', 'você', 'pelo',
    'pela', 'muito', 'onde', 'quando', 'quem', 'ser', 'está', 'também', 'já',
    'ao', 'aos', 'à', 'às', 'no', 'na', 'nos', 'nas', 'ou', 'mas',
  ],
  nl: [
    'de', 'het', 'een', 'en', 'zijn', 'voor', 'met', 'op', 'van', 'in',
    'door', 'dat', 'die', 'niet', 'ook', 'of', 'maar', 'hoe', 'alle', 'elke',
    'naar', 'bij', 'als', 'aan', 'uit', 'wordt', 'worden', 'kan', 'je', 'wij',
    'te', 'er', 'om', 'dan', 'deze', 'dit', 'zonder', 'meer', 'nog', 'ze',
  ],
};

/**
 * `word -> language -> weight`, built once from {@link STOPWORDS}.
 *
 * The weight is the inverse of how many of these languages use the word, which
 * is the whole discrimination mechanism: "les" (French alone) is worth a full
 * point, "de" (French, Spanish, Portuguese, Dutch) is worth a quarter of one.
 */
const WEIGHT: Map<string, Map<string, number>> = (() => {
  const owners = new Map<string, string[]>();
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    for (const w of list) {
      const cur = owners.get(w);
      if (cur) cur.push(lang);
      else owners.set(w, [lang]);
    }
  }
  const out = new Map<string, Map<string, number>>();
  for (const [word, langs] of owners) {
    const per = new Map<string, number>();
    for (const lang of langs) per.set(lang, 1 / langs.length);
    out.set(word, per);
  }
  return out;
})();

/**
 * Letters and marks that are close to exclusive to one language. Worth a point
 * each, capped at one point per language, because a single "ß" is a strong hint
 * but three of them are not three times stronger.
 */
const SIGNATURE: { lang: string; re: RegExp }[] = [
  { lang: 'de', re: /[ßäöü]/i },
  { lang: 'es', re: /[ñ¿¡]/i },
  { lang: 'pt', re: /[ãõ]/i },
  { lang: 'fr', re: /[œêâîûëï]/i },
];

/** A text shorter than this many words is not judged at all. */
const MIN_WORDS = 4;

/**
 * The winner needs at least this much weighted evidence. In the units above,
 * 1.5 is roughly "two words nobody else uses", or a longer run of shared ones.
 */
const MIN_SCORE = 1.5;

/** …and must beat the runner-up by this ratio. Near-ties abstain. */
const MIN_MARGIN = 1.5;

/** Word characters include the accented Latin range; digits and symbols do not. */
const WORD_SPLIT = /[^a-zÀ-ɏ'’]+/i;

/* ------------------------------------------------------------------ api */

export interface Detection {
  lang: DetectedLang;
  /** Roughly how far clear of the runner-up this call was. Diagnostic only. */
  margin: number;
}

/**
 * Detect the language of `text`, or return `null` when the evidence is thin.
 *
 * `null` is a normal, frequent answer and callers must render it as "say
 * nothing" — not as a fallback to English.
 */
export function detectLang(text: string): Detection | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length < 8) return null;

  /* --- stage 1: script share ---------------------------------------- */
  let latin = 0;
  const scriptCounts = new Map<DetectedLang, number>();
  for (const ch of trimmed) {
    if (LATIN.test(ch)) {
      latin += 1;
      continue;
    }
    for (const { lang, re } of SCRIPTS) {
      if (re.test(ch)) {
        scriptCounts.set(lang, (scriptCounts.get(lang) ?? 0) + 1);
        break;
      }
    }
  }

  const kana = scriptCounts.get('ja') ?? 0;
  const han = scriptCounts.get('zh') ?? 0;
  // Kana is exclusive to Japanese, so any meaningful amount of it makes the
  // accompanying Han characters Japanese too rather than a second script.
  if (kana > 0) {
    scriptCounts.set('ja', kana + han);
    scriptCounts.delete('zh');
  }

  const scripted = [...scriptCounts.values()].reduce((a, b) => a + b, 0);
  const letters = latin + scripted;
  if (letters === 0) return null;

  let bestScript: DetectedLang | null = null;
  let bestScriptN = 0;
  for (const [lang, n] of scriptCounts) {
    if (n > bestScriptN) {
      bestScript = lang;
      bestScriptN = n;
    }
  }
  if (bestScript && bestScriptN >= SCRIPT_MIN_CHARS && bestScriptN / letters >= SCRIPT_SHARE) {
    return { lang: bestScript, margin: bestScriptN / letters };
  }
  // A non-Latin script that is present but under the bar makes the whole text
  // ambiguous rather than Latin — refuse instead of falling through to the
  // stopword stage, which only knows Latin languages.
  if (scripted > 0 && scripted / letters > 0.12) return null;

  /* --- stage 2: stopwords ------------------------------------------- */
  const words = trimmed
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((w) => w.length > 0);
  if (words.length < MIN_WORDS) return null;

  const scores = new Map<string, number>();
  for (const lang of Object.keys(STOPWORDS)) scores.set(lang, 0);
  for (const w of words) {
    const per = WEIGHT.get(w);
    if (!per) continue;
    for (const [lang, weight] of per) scores.set(lang, (scores.get(lang) ?? 0) + weight);
  }
  for (const { lang, re } of SIGNATURE) {
    if (re.test(trimmed)) scores.set(lang, (scores.get(lang) ?? 0) + 1);
  }

  let top: string | null = null;
  let topScore = 0;
  let runnerUp = 0;
  for (const [lang, score] of scores) {
    if (score > topScore) {
      runnerUp = topScore;
      top = lang;
      topScore = score;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!top || topScore < MIN_SCORE) return null;
  // Beat the field by a ratio, not by a single shared word. Two languages that
  // score alike on the same overlapping words produce no answer at all.
  if (topScore < runnerUp * MIN_MARGIN) return null;

  return { lang: top as DetectedLang, margin: topScore - runnerUp };
}
