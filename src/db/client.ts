/**
 * op-SQLite connection layer for the app's single database (`substreamer7.db`).
 *
 * Opens the DB file, applies the PRAGMAs, and adapts op-SQLite's API to the
 * `InternalDb` surface every persistence module consumes.
 * `store/persistence/db.ts` owns schema creation and the exports.
 *
 * op-SQLite mandates ONE connection per DB and runs pool work on a single thread. But
 * `execute` and `executeBatch` do NOT enter that pool the same way: `execute` goes
 * straight to native, while `executeBatch` parks on a JS-side transaction lock and is
 * dispatched a `setImmediate` later, wrapped in its own `BEGIN TRANSACTION`/`COMMIT`
 * (`op-sqlite/src/functions.ts:48-68, 93-123`). So a read or write issued AFTER a batch
 * can reach the engine BEFORE it, and anything issued while a batch's transaction is
 * open joins that transaction. Do not assume submission order is execution order.
 *
 * Import-safety: op-SQLite is a native module absent under Node/Jest, so a global
 * manual mock (`__mocks__/@op-engineering/op-sqlite.js`) backs it with an
 * in-memory better-sqlite3 adapter for tests.
 */
import {
  open,
  type DB,
  type QueryResult,
  type Scalar,
  type SQLBatchTuple,
} from '@op-engineering/op-sqlite';
import { Directory, Paths } from 'expo-file-system';

/** Row-modification counts for a write, mapped from op-SQLite's
 *  `rowsAffected` / `insertId` by {@link adapt}. */
export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

/** One statement + its bound params for a batched write. Scalars only (op-SQLite
 *  binds string | number | null); the repository coerces before building these. */
export type BatchCommand = readonly [sql: string, params: ReadonlyArray<string | number | null>];

/** The DB surface every persistence module consumes. */
export interface InternalDb {
  getFirstSync<T>(sql: string, params?: readonly unknown[]): T | undefined;
  getAllSync<T>(sql: string, params?: readonly unknown[]): T[];
  getAllAsync<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  runSync(sql: string, params?: readonly unknown[]): RunResult;
  runAsync(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  /**
   * Run many statements off the JS thread. The native side aborts on the first failing
   * statement (`cpp/OPBridge.cpp`), but op-SQLite's JS wrapper brackets the whole call in
   * `BEGIN TRANSACTION`/`COMMIT` and rolls back on failure, so this is atomic in
   * practice despite the native layer's autocommit. {@link InternalDb.runAtomicBatchAsync}
   * additionally nests a SAVEPOINT.
   */
  runBatchAsync(commands: readonly BatchCommand[]): Promise<void>;
  /**
   * Run many statements as ONE all-or-nothing batch off the JS thread: the same
   * `executeBatch`, bracketed by `SAVEPOINT`/`RELEASE`, with a `ROLLBACK TO`
   * enqueued behind it in the same tick. Rejects with the ORIGINAL statement error,
   * after the savepoint has been popped.
   */
  runAtomicBatchAsync(commands: readonly BatchCommand[]): Promise<void>;
  execSync(sql: string): void;
  /**
   * BEGIN/COMMIT via `executeSync` — on the JS thread, bypassing the pool, so an
   * open pool transaction makes the BEGIN a hard error on Android. Callers must
   * either run where nothing else writes (boot, the migration chain) or await
   * {@link awaitDbWritesIdle} first, as logout does.
   */
  withTransactionSync(fn: () => void): void;
}

export const DB_NAME = 'substreamer7.db';
const DB_SUBDIR = 'SQLite';

/**
 * The plain filesystem directory that holds the DB: `<document>/SQLite` on both
 * platforms (iOS `.../Documents/SQLite`, Android `.../files/SQLite`). op-SQLite
 * needs a plain path, not a `file://` URI. Falls back to a bare subdir name if the
 * FS API is unavailable (Jest — the mock forces in-memory and ignores the location).
 */
function resolveDbLocation(): string {
  try {
    const docPath = Paths.document.uri.replace(/^file:\/\//, '').replace(/\/+$/, '');
    return `${docPath}/${DB_SUBDIR}`;
  } catch {
    return DB_SUBDIR;
  }
}

/** Ensure `<document>/SQLite` exists before opening — op-SQLite does not create
 *  intermediate dirs, so a fresh install would otherwise fail to open. */
function ensureDbDir(): void {
  try {
    const dir = new Directory(Paths.document, DB_SUBDIR);
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    /* already exists, or FS unavailable under test */
  }
}

const toParams = (params?: readonly unknown[]): Scalar[] | undefined =>
  params as unknown as Scalar[] | undefined;

const toRunResult = (r: QueryResult): RunResult => ({
  changes: r.rowsAffected,
  lastInsertRowId: r.insertId ?? 0,
});

/**
 * Pool writes currently outstanding, and everyone waiting for that to reach zero.
 *
 * This TRACKS writes, it does not serialize them: nothing waits on anything else, so
 * there is no ordering cost and no hot-path cost beyond a counter. It exists to know
 * when it is safe to run a JS-thread `BEGIN` (`withTransactionSync`), which bypasses
 * the pool entirely and hard-fails on Android if a pool transaction is open.
 */
let inFlightWrites = 0;
let idleWaiters: Array<() => void> = [];

function trackWrite<T>(work: Promise<T>): Promise<T> {
  inFlightWrites += 1;
  const settle = (): void => {
    inFlightWrites -= 1;
    if (inFlightWrites > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  };
  // Both handlers, and the ORIGINAL promise is what we return: the derived promise
  // always resolves (so a failed write is never an unhandled rejection here), while
  // the caller still sees the rejection it has to handle.
  work.then(settle, settle);
  return work;
}

/**
 * Resolve once no pool-queued write is outstanding on the connection.
 *
 * Await this before any JS-thread `executeSync` transaction — logout's
 * `resetNormalizedSchema` DROP loop is the only runtime caller.
 */
export function awaitDbWritesIdle(): Promise<void> {
  if (inFlightWrites === 0) return Promise.resolve();
  return new Promise<void>((resolve) => idleWaiters.push(resolve));
}

/** Test seam: wrap a raw op-SQLite DB so a suite can run the real code against a
 *  file-backed fixture instead of the in-memory default. Production opens via `openDb`. */
export function adaptForTests(op: DB): InternalDb {
  return adapt(op);
}

/** Adapt op-SQLite's DB to the `InternalDb` surface. `withTransactionSync` issues
 *  its BEGIN/COMMIT via `executeSync`; multi-statement ASYNC writes use
 *  `runAtomicBatchAsync` rather than a transaction spanning JS turns. */
function adapt(op: DB): InternalDb {
  return {
    getFirstSync<T>(sql: string, params?: readonly unknown[]): T | undefined {
      return op.executeSync(sql, toParams(params)).rows[0] as T | undefined;
    },
    getAllSync<T>(sql: string, params?: readonly unknown[]): T[] {
      return op.executeSync(sql, toParams(params)).rows as unknown as T[];
    },
    async getAllAsync<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      return (await op.execute(sql, toParams(params))).rows as unknown as T[];
    },
    async getFirstAsync<T>(sql: string, params?: readonly unknown[]): Promise<T | null> {
      return ((await op.execute(sql, toParams(params))).rows[0] ?? null) as T | null;
    },
    runSync(sql: string, params?: readonly unknown[]): RunResult {
      return toRunResult(op.executeSync(sql, toParams(params)));
    },
    async runAsync(sql: string, params?: readonly unknown[]): Promise<RunResult> {
      return toRunResult(await trackWrite(op.execute(sql, toParams(params))));
    },
    async runBatchAsync(commands: readonly BatchCommand[]): Promise<void> {
      if (commands.length === 0) return;
      await trackWrite(op.executeBatch(commands as unknown as SQLBatchTuple[]));
    },
    async runAtomicBatchAsync(commands: readonly BatchCommand[]): Promise<void> {
      if (commands.length === 0) return;
      // op-SQLite's JS `executeBatch` does NOT reach the pool at call time. It parks the
      // batch on a transaction lock and dispatches it from a `setImmediate`
      // (`op-sqlite/src/functions.ts:48-68`), then brackets it in a JS-thread
      // `BEGIN TRANSACTION` / `COMMIT`, with `ROLLBACK;` on failure (`:93-123`). So the
      // wrapper already makes this atomic, and a plain `execute` issued afterwards can
      // reach the pool FIRST. `musicCacheStore.ts:234-243` documents the same thing.
      //
      // The SAVEPOINT nests inside the wrapper's transaction and costs nothing. What used
      // to follow it — an unconditional "recovery" batch — was removed: see below.
      const batch = trackWrite(
        op.executeBatch([
          ['SAVEPOINT op_batch', []],
          ...commands,
          ['RELEASE op_batch', []],
        ] as unknown as SQLBatchTuple[]),
      );
      // NO recovery batch here, deliberately. There used to be a second `executeBatch`
      // issued in the same tick to `ROLLBACK TO op_batch`, on the theory that a failed
      // batch strands its savepoint. It did far more harm than good: on the SUCCESS path
      // its `ROLLBACK TO` fails (the savepoint is already released), the JS wrapper's
      // catch fires `ROLLBACK;`, and that discards everything written since the wrapper's
      // own `BEGIN TRANSACTION` — including unrelated writes from other callers, because
      // the recovery runs a `setImmediate` later, after this function has returned.
      //
      // That is what silently ate the Navidrome re-key's ETL completion stamp. Measured on
      // device over repeated restore-and-boot cycles: 5 of 5 runs lost the write with the
      // recovery batch present, 7 of 7 kept it with the recovery batch removed and no
      // other change. It is also unnecessary — the wrapper's own `ROLLBACK;` already
      // discards the transaction the stranded savepoint lived in.
      await batch;
    },
    execSync(sql: string): void {
      op.executeSync(sql);
    },
    withTransactionSync(fn: () => void): void {
      op.executeSync('BEGIN');
      try {
        fn();
        op.executeSync('COMMIT');
      } catch (e) {
        try {
          op.executeSync('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
  };
}

export interface DbConnection {
  raw: DB;
  db: InternalDb;
  location: string;
}

/**
 * Open the DB with op-SQLite and apply the PRAGMAs. Throws on failure (the caller
 * sets init-error state).
 */
export function openDbConnection(): DbConnection {
  ensureDbDir();
  const location = resolveDbLocation();
  const raw = open({ name: DB_NAME, location });

  raw.executeSync('PRAGMA journal_mode = WAL;');
  // Fold any leftover WAL at boot so the first (boot-critical, synchronous) reads
  // aren't stuck rebuilding/traversing a large WAL — e.g. after a big write that
  // didn't checkpoint before an unclean close (a crash/SIGKILL). Best-effort;
  // normally a fast no-op since the WAL auto-checkpoints during use.
  try {
    raw.executeSync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    /* best-effort */
  }
  raw.executeSync('PRAGMA synchronous = NORMAL;');
  raw.executeSync('PRAGMA foreign_keys = ON;');
  raw.executeSync('PRAGMA busy_timeout = 5000;');
  raw.executeSync('PRAGMA cache_size = -32000;');
  raw.executeSync('PRAGMA temp_store = MEMORY;');

  // Boot diagnostic: engine + resolved file location, then a PRAGMA readback.
  // `console.*` is stripped from release builds — dev/Metro only.
  try {
    // eslint-disable-next-line no-console
    console.log('[db] engine=op-sqlite', { name: DB_NAME, file: raw.getDbPath(), location });
    // eslint-disable-next-line no-console
    console.log('[db] PRAGMA readback', {
      busy_timeout: raw.executeSync('PRAGMA busy_timeout;').rows[0],
      cache_size: raw.executeSync('PRAGMA cache_size;').rows[0],
      temp_store: raw.executeSync('PRAGMA temp_store;').rows[0],
      journal_mode: raw.executeSync('PRAGMA journal_mode;').rows[0],
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[db] readback failed', e);
  }

  return { raw, db: adapt(raw), location };
}
