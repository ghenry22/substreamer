/**
 * Test-only op-SQLite ⇄ better-sqlite3 adapter.
 *
 * op-SQLite is a native TurboModule — it cannot load under Node/Jest (its own Node
 * build is broken in the shipped package), so every DB-touching test needs a stand-in.
 * This adapter presents op-SQLite's real API shape backed by an in-memory
 * `better-sqlite3`, so tests run REAL SQL through one shared adapter rather than
 * hand-rolled SQL-string-matching fakes.
 *
 * Wire it up per-suite (or via `moduleNameMapper`):
 *   jest.mock('@op-engineering/op-sqlite', () =>
 *     require('../db/testing/opSqliteBetterSqlite3').createOpSqliteMock());
 *
 * Faithful to op-SQLite's semantics that matter for us:
 *  - `execute` is async, `executeSync` is sync, both return the `QueryResult` shape.
 *  - `executeBatch`/`transaction` are deferred behind a lock; everything else applies
 *    at call time (see {@link makeDb}'s lock).
 *  - reactive queries fire on **transaction commit** (or `flushPendingReactiveQueries`),
 *    keyed on the written table — NOT on bare writes. This mirrors op-SQLite so the
 *    reactive layer is exercised the same way in tests as on device.
 */
import Database from 'better-sqlite3';

import type {
  DB,
  QueryResult,
  Scalar,
  SQLBatchTuple,
  Transaction,
} from '@op-engineering/op-sqlite';

/** op-SQLite's `OpenOptions` isn't re-exported from the package's main entry,
 *  only its internal types module — declare the subset we use. */
type OpenOptions = { name: string; location?: string; encryptionKey?: string; readOnly?: boolean };

/** better-sqlite3 rejects booleans/undefined/ArrayBuffer as binds; op-SQLite's
 *  `Scalar` allows them. Coerce to what better-sqlite3 accepts. */
function coerceParams(params?: Scalar[]): unknown[] {
  return (params ?? []).map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof ArrayBuffer) return Buffer.from(p);
    if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
    return p;
  });
}

/** Extract the target table of a write statement (INSERT/UPDATE/DELETE/REPLACE)
 *  for reactive-query dirty-tracking. Good enough for our generated SQL. */
function writtenTable(sql: string): string | null {
  const m = sql.match(
    /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["'`]?([A-Za-z0-9_]+)["'`]?/i,
  );
  return m ? m[1] : null;
}

interface ReactiveSub {
  query: string;
  args: Scalar[];
  tables: Set<string>;
  callback: (response: QueryResult) => void;
}

function makeDb(bs: Database.Database, dbPath: string): DB {
  const reactive = new Set<ReactiveSub>();
  const dirtyTables = new Set<string>();

  const run = (query: string, params?: Scalar[]): QueryResult => {
    // better-sqlite3 rejects transaction-control statements via prepared
    // statements (it wants exec()) — route BEGIN/COMMIT/ROLLBACK through exec().
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i.test(query)) {
      bs.exec(query);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = bs.prepare(query);
    const args = coerceParams(params);
    if (stmt.reader) {
      const rows = stmt.all(...args) as Array<Record<string, Scalar>>;
      const columnNames = stmt.columns().map((c) => c.name);
      return { rows, rowsAffected: 0, columnNames };
    }
    const info = stmt.run(...args);
    const table = writtenTable(query);
    if (table) dirtyTables.add(table);
    return {
      rows: [],
      rowsAffected: info.changes,
      insertId: Number(info.lastInsertRowid),
    };
  };

  /**
   * op-SQLite's JS-side transaction lock, mirroring `enhanceDB`
   * (`@op-engineering/op-sqlite/src/functions.ts:44-68`, used at `:93-125` and
   * `:187-267`). `executeBatch` and `transaction` do NOT reach the engine when you
   * call them: each parks on the queue and the head is started from a `setImmediate`
   * (`:64-66`), one at a time. `execute`/`executeSync`/`executeRaw` pass straight
   * through to the binding at call time (`:142-191`).
   *
   * So a read — or a bare `runAsync` write — issued AFTER a batch is applied BEFORE
   * it. That is ordinary JS scheduling, not native concurrency, so it belongs in the
   * adapter: applying batches synchronously here hid two shipped write-ordering bugs.
   */
  const lock = { queue: [] as Array<() => void>, inProgress: false };

  const startNextTransaction = (): void => {
    if (lock.inProgress) return;
    const start = lock.queue.shift();
    if (!start) return;
    lock.inProgress = true;
    setImmediate(start);
  };

  const onTransactionLock = <T>(work: () => Promise<T>): Promise<T> => {
    const guarded = async (): Promise<T> => {
      try {
        return await work();
      } finally {
        lock.inProgress = false;
        startNextTransaction();
      }
    };
    return new Promise<T>((resolve, reject) => {
      lock.queue.push(() => {
        guarded().then(resolve).catch(reject);
      });
      startNextTransaction();
    });
  };

  const fireReactive = (): void => {
    if (dirtyTables.size === 0) return;
    const touched = new Set(dirtyTables);
    dirtyTables.clear();
    for (const sub of reactive) {
      let hit = false;
      for (const t of sub.tables) if (touched.has(t)) hit = true;
      if (hit) sub.callback(run(sub.query, sub.args));
    }
  };

  const db: DB = {
    execute: (query, params) => Promise.resolve(run(query, params)),
    executeSync: (query, params) => run(query, params),
    // N statements in AUTOCOMMIT, matching the native implementation: op-SQLite's
    // `opsqlite_execute_batch` loops `opsqlite_execute` with its `BEGIN EXCLUSIVE
    // TRANSACTION` commented out (cpp/OPBridge.cpp) and leaves the transaction to the JS
    // caller. Wrapping a BEGIN here would both hide that (a batch would look atomic when
    // it is not) and make a caller's own outer transaction a nested-BEGIN error.
    // `runAtomicBatchAsync` gets its atomicity by passing SAVEPOINT/RELEASE as ordinary
    // commands, which `run()` routes through `bs.exec` — so it is modelled faithfully.
    executeBatch: (commands: SQLBatchTuple[]) =>
      onTransactionLock(async () => {
        // Bracketed in BEGIN/COMMIT, with ROLLBACK on failure, because op-SQLite's JS
        // wrapper does exactly that around every `executeBatch`
        // (`op-sqlite/src/functions.ts:93-123`) — the native layer's autocommit is not
        // what callers actually observe. Without this the adapter made a batch
        // non-atomic, so the app's own SAVEPOINT+recovery scaffolding looked load-bearing
        // in tests while on device it was the thing rolling other callers' writes back.
        bs.exec('BEGIN TRANSACTION');
        let rowsAffected = 0;
        try {
          for (const [query, params] of commands) {
            if (Array.isArray(params) && Array.isArray(params[0])) {
              for (const p of params as Scalar[][]) rowsAffected += run(query, p).rowsAffected;
            } else {
              rowsAffected += run(query, params as Scalar[] | undefined).rowsAffected;
            }
          }
          bs.exec('COMMIT');
        } catch (e) {
          bs.exec('ROLLBACK');
          throw e;
        }
        fireReactive();
        return { rowsAffected };
      }),
    transaction: (fn: (tx: Transaction) => Promise<void>) =>
      onTransactionLock(async () => {
        bs.exec('BEGIN');
        const tx: Transaction = {
          execute: (query, params) => Promise.resolve(run(query, params)),
          commit: () => ({ rows: [], rowsAffected: 0 }),
          rollback: () => ({ rows: [], rowsAffected: 0 }),
        };
        try {
          await fn(tx);
          bs.exec('COMMIT');
          fireReactive();
        } catch (e) {
          try { bs.exec('ROLLBACK'); } catch { /* ignore */ }
          throw e;
        }
      }),
    reactiveExecute: ({ query, arguments: args, fireOn, callback }) => {
      const sub: ReactiveSub = {
        query,
        args: args ?? [],
        tables: new Set(fireOn.map((f) => f.table)),
        callback,
      };
      reactive.add(sub);
      return () => reactive.delete(sub);
    },
    flushPendingReactiveQueries: () => {
      fireReactive();
      return Promise.resolve();
    },
    prepareStatement: (query: string) => {
      let bound: Scalar[] = [];
      return {
        bind: (params: Scalar[]) => { bound = params; return Promise.resolve(); },
        bindSync: (params: Scalar[]) => { bound = params; },
        execute: () => Promise.resolve(run(query, bound)),
        executeSync: () => run(query, bound),
      };
    },
    getDbPath: () => dbPath,
    close: () => bs.close(),
    closeAsync: () => { bs.close(); return Promise.resolve(); },
    delete: () => bs.close(),
    interrupt: () => { /* no-op in the mock */ },
    updateHook: () => { /* no-op */ },
    commitHook: () => { /* no-op */ },
    rollbackHook: () => { /* no-op */ },
    attach: () => { /* no-op */ },
    detach: () => { /* no-op */ },
    loadExtension: () => { /* no-op */ },
    sync: () => { /* no-op */ },
    setReservedBytes: () => { /* no-op */ },
    getReservedBytes: () => 0,
    executeWithHostObjects: (query, params) => Promise.resolve(run(query, params)),
    executeRaw: (query, params) => {
      const r = run(query, params);
      return Promise.resolve({
        rowsAffected: r.rowsAffected,
        rawRows: r.rows.map((row) => Object.values(row)),
        columnNames: r.columnNames ?? [],
      });
    },
    executeRawSync: (query, params) => {
      const r = run(query, params);
      return {
        rowsAffected: r.rowsAffected,
        rawRows: r.rows.map((row) => Object.values(row)),
        columnNames: r.columnNames ?? [],
      };
    },
    loadFile: () => Promise.resolve({ rowsAffected: 0 }),
  };
  return db;
}

/** Returns an object matching the `@op-engineering/op-sqlite` module surface,
 *  backed by better-sqlite3. `location: ':memory:'` (or an unset location) opens
 *  an in-memory DB — the default for tests. */
export function createOpSqliteMock() {
  const open = (opts: OpenOptions): DB => {
    const path =
      opts.location === ':memory:' || !opts.location ? ':memory:' : `${opts.location}/${opts.name}`;
    const bs = new Database(path === ':memory:' ? ':memory:' : path);
    if (path !== ':memory:') bs.pragma('journal_mode = WAL');
    bs.pragma('foreign_keys = ON');
    return makeDb(bs, path);
  };
  return {
    open,
    openSync: open,
    openAsync: (opts: OpenOptions) => Promise.resolve(open(opts)),
    moveAssetsDatabase: () => Promise.resolve(true),
    isSQLCipher: () => false,
    isLibsql: () => false,
    isIOSEmbedded: () => false,
    IOS_LIBRARY_PATH: '/tmp',
    IOS_DOCUMENT_PATH: '/tmp',
    ANDROID_DATABASE_PATH: '/tmp',
    ANDROID_FILES_PATH: '/tmp',
    ANDROID_EXTERNAL_FILES_PATH: '/tmp',
  };
}
