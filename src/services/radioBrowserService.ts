/**
 * Client for the community radio directory at radio-browser.info (free, no
 * API key). Used by the station-catalog screen to find new stations and add
 * them to the user's own server via createInternetRadioStation.
 *
 * Etiquette per https://api.radio-browser.info: send an identifying
 * User-Agent and use the round-robin `all.api` host.
 */

const BASE_URL = 'https://all.api.radio-browser.info/json';
const USER_AGENT = 'substreamer-radio/1.0';

export const CATALOG_PAGE_SIZE = 40;

/** Subset of the radio-browser station record the UI cares about. */
export interface CatalogStation {
  /** radio-browser stationuuid. */
  id: string;
  name: string;
  /** Playable URL (radio-browser's url_resolved — playlists already unwrapped). */
  streamUrl: string;
  homepage: string | null;
  favicon: string | null;
  /** Comma-separated tag list as provided by the directory. */
  tags: string;
  countryCode: string;
  codec: string;
  bitrate: number;
  votes: number;
}

interface RawCatalogStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  countrycode?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
}

/** Map a raw directory record; null when it lacks the essentials. */
export function toCatalogStation(raw: RawCatalogStation): CatalogStation | null {
  const streamUrl = raw.url_resolved || raw.url;
  const name = raw.name?.trim();
  if (!raw.stationuuid || !name || !streamUrl) return null;
  return {
    id: raw.stationuuid,
    name,
    streamUrl,
    homepage: raw.homepage || null,
    favicon: raw.favicon || null,
    tags: raw.tags ?? '',
    countryCode: raw.countrycode ?? '',
    codec: raw.codec ?? '',
    bitrate: raw.bitrate ?? 0,
    votes: raw.votes ?? 0,
  };
}

/** Compact "FR • MP3 128 kbps • jazz" meta line for a catalog row. */
export function catalogStationMeta(station: CatalogStation): string {
  const parts: string[] = [];
  if (station.countryCode) parts.push(station.countryCode);
  if (station.codec) {
    parts.push(station.bitrate > 0 ? `${station.codec} ${station.bitrate} kbps` : station.codec);
  }
  const firstTag = station.tags.split(',')[0]?.trim();
  if (firstTag) parts.push(firstTag);
  return parts.join(' • ');
}

/**
 * Search the directory by free-text name (empty query → most-voted stations).
 * Returns null on network/HTTP failure so the UI can show a retryable error.
 */
export async function searchCatalogStations(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogStation[] | null> {
  const params = new URLSearchParams({
    limit: String(CATALOG_PAGE_SIZE),
    hidebroken: 'true',
    order: 'votes',
    reverse: 'true',
  });
  const trimmed = query.trim();
  if (trimmed) params.set('name', trimmed);
  try {
    const response = await fetchImpl(`${BASE_URL}/stations/search?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as RawCatalogStation[];
    if (!Array.isArray(data)) return null;
    return data
      .map(toCatalogStation)
      .filter((s): s is CatalogStation => s !== null);
  } catch {
    return null;
  }
}
