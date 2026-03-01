/**
 * MusicBrainz API service.
 *
 * Provides helpers to resolve an artist MBID (MusicBrainz ID) by name and to
 * fetch a Wikipedia-sourced biography for a given MBID.
 *
 * Rate-limit note: MusicBrainz enforces a maximum of ~1 request per second.
 * These functions are typically called once per artist detail view, so no
 * client-side throttle is implemented here. If usage increases, add a rate
 * limiter (e.g. a simple delay queue).
 */

const API_BASE_URL = 'https://musicbrainz.org/ws/2/';
const WEB_BASE_URL = 'https://musicbrainz.org/artist/';
const USER_AGENT = 'Substreamer/1.0.0 (https://github.com/substreamer)';

// ── Types ───────────────────────────────────────────────────────────────────

/** Shape of a single artist entry returned by the MusicBrainz search API. */
export interface MusicBrainzArtist {
  id: string;
  name: string;
  score?: number;
  type?: string;
  country?: string;
  disambiguation?: string;
}

/** Top-level response from the MusicBrainz artist search endpoint. */
export interface MusicBrainzArtistSearchResult {
  created: string;
  count: number;
  offset: number;
  artists: MusicBrainzArtist[];
}

/** Shape of the Wikipedia extract object returned by MusicBrainz. */
export interface WikipediaExtract {
  canonical?: string;
  title?: string;
  content?: string;
  language?: string;
  url?: string;
}

/** Response from the MusicBrainz Wikipedia extract endpoint. */
interface WikipediaExtractResponse {
  wikipediaExtract?: WikipediaExtract;
}

// ── Functions ───────────────────────────────────────────────────────────────

/**
 * Search for an artist by name and return the best-matching MBID.
 *
 * Uses the MusicBrainz search API with `limit=1` to retrieve the single
 * highest-scoring match.
 *
 * @param artistName  The artist name to search for.
 * @returns The MBID string, or `null` if no match is found or an error occurs.
 */
export async function searchArtistMBID(artistName: string): Promise<string | null> {
  try {
    const query = `artist:${artistName}`;
    const url = `${API_BASE_URL}artist/?query=${encodeURIComponent(query)}&fmt=json&limit=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;

    const data: MusicBrainzArtistSearchResult = await response.json();

    if (data.artists && data.artists.length > 0) {
      return data.artists[0].id;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Search for artists by name and return multiple results for user selection.
 *
 * @param query  The artist name / search query.
 * @param limit  Maximum number of results (default 10).
 * @returns Array of matching artists, or empty array on failure.
 */
export async function searchArtists(
  query: string,
  limit = 10,
): Promise<MusicBrainzArtist[]> {
  try {
    const url = `${API_BASE_URL}artist/?query=${encodeURIComponent(`artist:${query}`)}&fmt=json&limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) return [];

    const data: MusicBrainzArtistSearchResult = await response.json();

    return data.artists ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch the Wikipedia biography for an artist by their MBID.
 *
 * Uses the MusicBrainz website's `/wikipedia-extract` endpoint which returns
 * a plain-text extract sourced from Wikipedia.
 *
 * @param mbid  The MusicBrainz ID of the artist.
 * @returns The biography text, or `null` if unavailable or an error occurs.
 */
export async function getArtistBiography(mbid: string): Promise<string | null> {
  try {
    const url = encodeURI(`${WEB_BASE_URL}${mbid}/wikipedia-extract`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;

    const data: WikipediaExtractResponse = await response.json();

    return data.wikipediaExtract?.content?.trim() ?? null;
  } catch {
    return null;
  }
}
