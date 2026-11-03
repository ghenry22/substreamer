/**
 * Does this install hold anything from a server?
 *
 * A fresh install, or one just logged out, holds nothing, and so has nothing a Navidrome
 * re-key could convert: whatever it syncs next already carries the server's current ids.
 */

import { KEPT_TABLES, MODEL_TABLES } from '../../db/createNormalizedTables';
import type { InternalDb } from '../../store/persistence/db';

/** The pre-normalized blob tables. Absent on a fresh install. */
const LEGACY_BLOB_TABLES = ['album_details', 'song_index', 'library_albums'];

/**
 * True when any server-scoped or kept table has a row. `storage` (the KV store) is left
 * out: it holds settings and the logged-out stores' initial state even on a fresh install.
 */
export async function installHoldsServerIds(db: InternalDb): Promise<boolean> {
  const present = new Set(
    (await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )).map((r) => r.name),
  );
  const tables = [...MODEL_TABLES, ...KEPT_TABLES, ...LEGACY_BLOB_TABLES]
    .filter((t) => t !== 'storage' && present.has(t));
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const row = await db.getFirstAsync<{ one: number }>(`SELECT 1 AS one FROM "${table}" LIMIT 1`);
    if (row) return true;
  }
  return false;
}
