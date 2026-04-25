/**
 * Article-stripped sort helpers for list views.
 *
 * Two helpers are exposed:
 *
 *   - `getSortKey(name, sortName?, articles?)` — returns the
 *     accent-folded, lowercased string to feed into `localeCompare`.
 *     Prefers a server-supplied `sortName` when present and meaningfully
 *     different from `name`; falls back to client-side article stripping.
 *   - `getSortFirstLetter(name, sortName?, articles?)` — returns the
 *     A–Z letter for the alphabet scroller, or `'#'` for non-alpha
 *     leading characters. Mirrors `getSortKey`'s normalisation so the
 *     scroller's section letter always matches where the entry actually
 *     sorts in the list.
 *
 * Article-list source — two-tier:
 *
 *   1. **Server's `ignoredArticles`** field (returned by
 *      `getIndexes` / `getArtists`) is preferred when provided. Single
 *      list per server, consistent across the app, respects the
 *      Subsonic/Navidrome admin's config.
 *   2. **`DEFAULT_IGNORED_ARTICLES`** below is the fallback when the
 *      server hasn't shipped the field. Trimmed for false positives —
 *      see the plan doc and inline rationale.
 */

/**
 * Conservative client-side fallback list. The Subsonic baseline
 * (`The El La Los Las Le Les Os As O A`) minus `A`, `An`, `As` (English
 * indefinite + preposition collisions) plus `L'` (French apostrophe form,
 * matched via a separate pattern that handles both `'` and U+2019).
 *
 * `der`, `die`, `das`, `ein`, `eine` (German), `il`, `lo`, `gli`, `i`
 * (Italian), `den`, `det`, `ett`, `et`, `ei` (Nordic), `het`, `de`,
 * `een` (Dutch), `e` (not an article) are NOT in the fallback — they
 * caused real false positives (De La Soul, I Mother Earth, E Street
 * Band) and a server with those languages in scope ships them via
 * `ignoredArticles` anyway.
 */
export const DEFAULT_IGNORED_ARTICLES: readonly string[] = [
  'the',
  'el',
  'la',
  'los',
  'las',
  'le',
  'les',
  'os',
  'o',
];

/**
 * `l'` apostrophe form — matches `L'amour`, `L'Île`, `L'  Île`. Both
 * straight ASCII apostrophe (U+0027) and right single quotation mark
 * (U+2019, what iOS auto-corrects to and what many ID3 taggers write).
 */
const APOSTROPHE_ARTICLE_RE = /^l['’]\s*/i;

/**
 * Build a regex that strips ONE leading article from a name. Articles
 * must be followed by `\s+` (one or more whitespace). The regex is
 * compiled once per article-list identity (server-supplied lists are
 * stable; the default is module-scoped); a small WeakMap-style cache
 * would only matter if list churn ever became real.
 */
function buildArticleRegex(articles: readonly string[]): RegExp {
  // Escape regex meta-chars in each article (defensive — articles in
  // the wild are alphabetic, but a server could ship something weird).
  const escaped = articles
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((a) => a.length > 0);
  // Empty article list → return a regex that can never match anything.
  if (escaped.length === 0) return /(?!)/;
  return new RegExp(`^(?:${escaped.join('|')})\\s+`, 'i');
}

const DEFAULT_ARTICLE_RE = buildArticleRegex(DEFAULT_IGNORED_ARTICLES);
const REGEX_CACHE = new WeakMap<readonly string[], RegExp>();

function articleRegexFor(articles?: readonly string[]): RegExp {
  if (!articles || articles === DEFAULT_IGNORED_ARTICLES) return DEFAULT_ARTICLE_RE;
  const cached = REGEX_CACHE.get(articles);
  if (cached) return cached;
  const compiled = buildArticleRegex(articles);
  REGEX_CACHE.set(articles, compiled);
  return compiled;
}

/** Strip one leading article from `name` if present. Never collapses to empty. */
export function stripArticle(name: string, articles?: readonly string[]): string {
  // L' apostrophe form first — it's structurally different (no whitespace
  // separator) and shouldn't be conditional on it being in the list.
  let candidate = name.replace(APOSTROPHE_ARTICLE_RE, '');
  if (candidate === name) {
    candidate = name.replace(articleRegexFor(articles), '');
  }
  // Guard: never let a strip leave us with an empty string. An album
  // literally titled "The" stays "The".
  return candidate.length > 0 ? candidate : name;
}

/**
 * Drop combining diacritics ("É" → "E", "ñ" → "n") so the alphabet
 * scroller can group accented entries under their base letter and the
 * sort comparator sees a clean ASCII-ish key.
 *
 * Hermes supports `String.prototype.normalize` (since RN 0.59) and
 * Unicode property escapes (since RN 0.72).
 */
function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * `sortName` from OpenSubsonic ships in two real shapes:
 *   - server-stripped (`"Beatles"`)
 *   - comma-suffix (`"Beatles, The"` — MusicBrainz Picard's `ALBUMSORT`)
 *
 * The comma-suffix form would interleave incoherently with article-
 * stripped values in the same list ("Beatles, The" sorts between
 * "Beatle" and "Beauty"). Detect and skip it; the caller falls back to
 * client-stripping `name`.
 */
function isCommaSuffixSortName(sortName: string): boolean {
  return /,\s+\w+\s*$/.test(sortName);
}

/**
 * Derive the comparison key for a list entry. Pass `sortName` (may be
 * undefined) and the server's article list (may be undefined to use the
 * default).
 */
export function getSortKey(
  name: string,
  sortName?: string | null,
  articles?: readonly string[],
): string {
  if (sortName && sortName !== name && !isCommaSuffixSortName(sortName)) {
    return foldAccents(sortName.toLowerCase());
  }
  return foldAccents(stripArticle(name, articles).toLowerCase());
}

/**
 * Derive the alphabet-scroller letter (`A`–`Z` or `'#'`) for a list
 * entry. Mirrors `getSortKey`'s normalisation — accent-folded and
 * article-stripped — so the scroller's section letter is always
 * coherent with where the entry sorts in the list.
 */
export function getSortFirstLetter(
  name: string,
  sortName?: string | null,
  articles?: readonly string[],
): string {
  const key = getSortKey(name, sortName, articles);
  const ch = key.charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}
