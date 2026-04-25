import {
  DEFAULT_IGNORED_ARTICLES,
  getSortFirstLetter,
  getSortKey,
  stripArticle,
} from '../sortHelpers';

describe('stripArticle (default list)', () => {
  it('strips each default article when followed by whitespace', () => {
    for (const article of DEFAULT_IGNORED_ARTICLES) {
      const cap = article.charAt(0).toUpperCase() + article.slice(1);
      expect(stripArticle(`${cap} Band`)).toBe('Band');
    }
  });

  it('does NOT strip an article when not followed by whitespace', () => {
    expect(stripArticle('Theatre')).toBe('Theatre');
    expect(stripArticle('Lacuna')).toBe('Lacuna');
  });

  it('strips only one article (no iterative strip)', () => {
    // "The The" → strip first "The ", remainder is "The". Sort under T.
    expect(stripArticle('The The')).toBe('The');
  });

  it('returns the original when stripping would leave an empty string', () => {
    expect(stripArticle('The')).toBe('The');
    expect(stripArticle('Le ')).toBe('Le ');
  });

  it('does NOT strip articles that are excluded from the default list', () => {
    // English a/an stay (per user direction)
    expect(stripArticle('A Tribe Called Quest')).toBe('A Tribe Called Quest');
    expect(stripArticle('An American In Paris')).toBe('An American In Paris');
    // English preposition "as"
    expect(stripArticle('As I Lay Dying')).toBe('As I Lay Dying');
    // Dutch/French "de" — "De La Soul" keeps the De (no false positive)
    expect(stripArticle('De La Soul')).toBe('De La Soul');
    // German articles
    expect(stripArticle('Die Toten Hosen')).toBe('Die Toten Hosen');
    expect(stripArticle('Der Plan')).toBe('Der Plan');
    // Italian
    expect(stripArticle('Il Divo')).toBe('Il Divo');
    expect(stripArticle('I Mother Earth')).toBe('I Mother Earth');
    // Portuguese conjunction (not an article)
    expect(stripArticle('E Street Band')).toBe('E Street Band');
  });

  it('handles `L\'` apostrophe form with a straight quote', () => {
    expect(stripArticle("L'amour")).toBe('amour');
    expect(stripArticle("L'  Île")).toBe('Île');
  });

  it('handles `L\'` apostrophe form with a smart quote (U+2019)', () => {
    expect(stripArticle('L’amour')).toBe('amour');
  });

  it('is case-insensitive', () => {
    expect(stripArticle('THE BEATLES')).toBe('BEATLES');
    expect(stripArticle('the beatles')).toBe('beatles');
    expect(stripArticle('LOS LOBOS')).toBe('LOBOS');
  });
});

describe('stripArticle with server-supplied article list', () => {
  it('uses the server-supplied list when provided', () => {
    // Server with German articles configured
    const articles = ['the', 'die', 'der', 'das'];
    expect(stripArticle('Die Toten Hosen', articles)).toBe('Toten Hosen');
    expect(stripArticle('The Beatles', articles)).toBe('Beatles');
  });

  it('caches the compiled regex per article-list identity', () => {
    const articles = Object.freeze(['the', 'die']);
    // Just call twice; mainly asserting no throw / consistent output.
    expect(stripArticle('Die Band', articles)).toBe('Band');
    expect(stripArticle('Die Band', articles)).toBe('Band');
  });

  it('handles an empty server-supplied list as a no-op (no strip)', () => {
    expect(stripArticle('The Beatles', [])).toBe('The Beatles');
  });
});

describe('getSortKey', () => {
  it('falls back to client-strip when sortName is undefined', () => {
    expect(getSortKey('The Beatles')).toBe('beatles');
  });

  it('falls back to client-strip when sortName equals name', () => {
    expect(getSortKey('The Beatles', 'The Beatles')).toBe('beatles');
  });

  it('uses sortName when it differs from name and is not comma-suffix form', () => {
    expect(getSortKey('The Beatles', 'Beatles')).toBe('beatles');
    expect(getSortKey('U2', 'You Two')).toBe('you two');
  });

  it('ignores comma-suffix sortName ("Beatles, The") and falls back to client-strip', () => {
    expect(getSortKey('The Beatles', 'Beatles, The')).toBe('beatles');
  });

  it('lowercases the result', () => {
    expect(getSortKey('THE BEATLES')).toBe('beatles');
  });

  it('folds accents — "Élise" sorts under e', () => {
    expect(getSortKey('Élise')).toBe('elise');
    expect(getSortKey('Über alles')).toBe('uber alles');
    expect(getSortKey('Ñoño')).toBe('nono');
  });

  it('preserves names without leading articles', () => {
    expect(getSortKey('Pearl Jam')).toBe('pearl jam');
    expect(getSortKey('U2')).toBe('u2');
  });
});

describe('getSortFirstLetter', () => {
  it('returns the first A–Z letter of the sort key', () => {
    expect(getSortFirstLetter('The Beatles')).toBe('B');
    expect(getSortFirstLetter('Pearl Jam')).toBe('P');
  });

  it('returns "#" for non-alpha leading characters', () => {
    expect(getSortFirstLetter('12 Stones')).toBe('#');
    expect(getSortFirstLetter('!Action')).toBe('#');
  });

  it('returns the accent-folded letter — "Élise" → E', () => {
    expect(getSortFirstLetter('Élise')).toBe('E');
    expect(getSortFirstLetter('Über alles')).toBe('U');
    expect(getSortFirstLetter('Ñoño')).toBe('N');
  });

  it('returns the band-letter when an indefinite article is in front (a/an stay)', () => {
    expect(getSortFirstLetter('A Tribe Called Quest')).toBe('A');
    expect(getSortFirstLetter('An American In Paris')).toBe('A');
  });

  it('honours server-supplied article list', () => {
    const articles = ['the', 'die'];
    expect(getSortFirstLetter('Die Toten Hosen', undefined, articles)).toBe('T');
  });

  it('returns "T" for "The The" (single-iteration strip)', () => {
    expect(getSortFirstLetter('The The')).toBe('T');
  });

  it('uses sortName when present and meaningful', () => {
    expect(getSortFirstLetter('The Beatles', 'Beatles')).toBe('B');
    expect(getSortFirstLetter('U2', 'You Two')).toBe('Y');
  });

  it('falls back to client-strip on comma-suffix sortName', () => {
    expect(getSortFirstLetter('The Beatles', 'Beatles, The')).toBe('B');
  });
});
