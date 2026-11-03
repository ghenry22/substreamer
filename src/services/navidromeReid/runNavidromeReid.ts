/**
 * The Navidrome 0.64 id re-key, start to finish.
 *
 * Runs behind the blocking interstitial: at cold start before the app launches, or later
 * in the session when a launch that could not reach the server reaches it. `_layout`'s
 * startup effects are gated on the same flag. The app may already be live in the second
 * case, so the pass quiets the player and the download and image workers before its first
 * write.
 *
 * Ordering is not arbitrary:
 *
 *   1. the FK-deferral self-check, before anything is written
 *   2. the live queue, cleared so a queue of retired ids is never restored
 *   3. the id map
 *   4. the database — plain columns, then duplicates, then embedded ids
 *   5. the files, which cannot be rolled back and so go last among the writes
 *   6. the stores, which still hold old ids in memory until they are rehydrated
 *   7. the marker, only once every step above has succeeded
 *
 * The marker is the only thing that stops this running again, and it is stamped last on
 * purpose: an interrupted run re-enters the interstitial on the next launch and repeats
 * from the top. Every step is idempotent, so repeating is free.
 */

import {
  cancelImageRefreshCycle,
  clearImageCache,
  enqueueImageRefreshCycle,
  processImageQueue,
} from '../imageCacheService';
import { imageDownloadQueueStore } from '../../store/imageDownloadQueueStore';
import { flushLibrarySyncLog, logLibrarySync } from '../librarySyncLogger';
import { appStateStore } from '../../store/appStateStore';
import { migrationGateStore } from '../../store/migrationGateStore';
import { haltDownloadWorkers, musicCacheReconcileInFlight, rebuildTrackMaps } from '../musicCacheService';
import { clearQueue } from '../playerService';
import { rehydrateAllStores } from '../../store/persistence/rehydrate';
import { ratingStore } from '../../store/ratingStore';
import { syncStatusStore } from '../../store/syncStatusStore';
import { clearImageQueue } from '../../store/persistence/imageDownloadQueueTable';
import { legacyMetadataConversionInFlight } from '../../store/persistence/musicCacheTables';
import { getDb } from '../../store/persistence/db';
import { buildIdMap, createIdMap, dropIdMap } from './reidMap';
import { moveDownloadedFiles } from './reidFiles';
import { rekeyKvBlobs } from './reidKv';
import { installHoldsServerIds } from './reidInstall';
import { discardLibrary } from './reidLibrary';
import { cannotAskNow } from './reidProbe';
import {
  hasContinuedAfterFailureThisSession,
  hasServerAnswered,
  isLegacyThisSession,
  reidVerdict,
  setContinuedAfterFailureThisSession,
  setLegacyThisSession,
  setReidState,
  setUserConfirmedReid,
} from './reidMarker';
import { appendReidLog } from './reidMigrationLog';
import { dataModelUpgradeInFlight } from '../dataModelUpgradeService';
import { MIGRATION_DONE_KEY, MIGRATION_VERSION } from '../normalizedMigrationKey';
import {
  deleteSupersededRows,
  rekeyEmbeddedIds,
  rekeyPlainColumns,
  verifyDeferredForeignKeys,
} from './reidRekey';

let inFlight: Promise<void> | null = null;
/** Set while a pass waits for the app to come to the foreground. */
let foregroundWait: (() => void) | null = null;

/**
 * Run the pass if this install needs it.
 *
 * Safe to call on every launch and whenever the server answers: it returns immediately
 * when the marker says complete, the server is not affected, or a run is already going.
 * An undetermined server version shows the `asking` prompt instead; the user's answer
 * triggers a fresh call.
 */
export function runNavidromeReidIfNeeded(): Promise<void> {
  if (inFlight) return inFlight;

  // Verdict FIRST. `skip` covers every install that will never need this — not
  // Navidrome, or already complete — and those must return silently: the availability
  // check below can never pass for them, because the probe short-circuits without ever
  // recording an answer, so testing it first logged "deferred" on every launch for
  // every user.
  const verdict = reidVerdict();
  if (verdict === 'skip') {
    // Retire a deferral the probe has since overtaken: we deferred while nothing could
    // answer, the server then answered pre-0.64, and the pass is not needed after all.
    // Without this the sync card goes on claiming a pending update that will never come.
    if (migrationGateStore.getState().deferred) migrationGateStore.getState().setDeferred(false);
    return Promise.resolve();
  }

  // An undetermined version runs in legacy mode until the user chooses to update, so it
  // is never `deferred`. The prompt waits for a server that has answered, because
  // "Update now" starts the pass.
  if (verdict === 'ask') {
    if (isLegacyThisSession() || cannotAskNow() || !hasServerAnswered()) {
      return Promise.resolve();
    }
    migrationGateStore.getState().show('asking');
    return Promise.resolve();
  }

  // The pass failed earlier this session and the user chose to carry on. The next launch
  // tries again; retrying here would loop on the same failure.
  if (hasContinuedAfterFailureThisSession()) return Promise.resolve();

  // Only now, for an install that genuinely needs the pass: may it run RIGHT NOW?
  //
  // Nothing about it is safe without a server to refill from. It discards the whole
  // library and depends on the sync that follows to rebuild it — measured on a fixture
  // with offline mode on and a persisted 0.64: "library discarded (45 tables)", marker
  // stamped complete, songs 0, and no sync able to run.
  //
  // `cannotAskNow()` alone is not enough — the connectivity flags default optimistically
  // to reachable, so a user away from home sails past it and the probe merely times out.
  // Require a CONFIRMED round-trip: only a server that actually answered proves there is
  // something to rebuild from. Kept out of `reidVerdict` deliberately — the verdict
  // answers "does this install need the re-key", which stays true offline; this answers
  // "may it run now", a different question with a different lifetime.
  if (cannotAskNow() || !hasServerAnswered()) {
    migrationGateStore.getState().setDeferred(true);
    logLibrarySync('[reid] deferred — no confirmed server; nothing could refill the library');
    appendReidLog('deferred', ['reason: no confirmed server — nothing could refill the library']);
    return Promise.resolve();
  }

  // Never start unseen. The pass stops playback and takes over the screen, so a server
  // that answers while the app is in the background (auto-offline turning off on home
  // Wi-Fi) waits until the user brings the app back.
  if (!appStateStore.getState().isActive) {
    runWhenForeground();
    return Promise.resolve();
  }

  inFlight = execute(verdict).finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Resolves once the pass has decided whether it needs the screen — either the gate is up,
 * so the splash can hand straight over to it, or the pass finished without needing one.
 *
 * NOT the pass itself: a real run is minutes long and the splash must not hold for it.
 * This exists so the read-only pre-flight happens BEHIND the splash instead of in front
 * of the user, who would otherwise see the app appear and then be covered again.
 *
 * No timeout of its own: the splash already fires its own safety timeout regardless, so
 * a stall here delays the hand-over rather than hanging the app.
 */
export function awaitReidDecision(pass: Promise<void>): Promise<void> {
  if (migrationGateStore.getState().visible) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve();
    };
    unsubscribe = migrationGateStore.subscribe((state) => { if (state.visible) finish(); });
    // Either outcome is a decision; a rejection still means the screen is no longer pending.
    void pass.then(finish, finish);
  });
}

/** Call the pass once, the next time the app comes to the foreground. */
function runWhenForeground(): void {
  if (foregroundWait) return;
  foregroundWait = appStateStore.subscribe((state, prev) => {
    if (!state.isActive || prev.isActive) return;
    foregroundWait?.();
    foregroundWait = null;
    void runNavidromeReidIfNeeded();
  });
}

/**
 * The user answered the `ask` prompt: their server is updated, run it.
 *
 * Their answer is persisted before the pass starts, so a kill mid-run does not put the
 * question back — the version string still cannot answer it and asking twice is worse
 * than remembering.
 */
export async function confirmAndRunNavidromeReid(): Promise<void> {
  // An install holding no server data has nothing to convert: whatever it syncs next
  // carries the server's current ids. Mark it done instead of running the full pass.
  const db = getDb();
  if (db && !(await installHoldsServerIds(db))) {
    setReidState('complete');
    migrationGateStore.getState().hide();
    logLibrarySync('[reid] update confirmed on an empty install; marked complete');
    return;
  }
  setUserConfirmedReid();
  migrationGateStore.getState().confirm();
  return runNavidromeReidIfNeeded();
}

/**
 * The user chose "Run in legacy mode" on the `ask` prompt. Everything keeps working on
 * the old ids; the prompt returns at the next launch.
 */
export function chooseLegacyMode(): void {
  setLegacyThisSession();
  migrationGateStore.getState().hide();
  logLibrarySync('[reid] legacy mode chosen for this session');
  appendReidLog('legacy mode', ['the server version is undetermined; the user chose legacy mode']);
}

/**
 * The user chose "Continue without updating" after a failed pass. Library writes stay
 * blocked this session and the Settings notice says so; the next launch retries.
 */
export function continueWithoutUpdating(): void {
  setContinuedAfterFailureThisSession();
  migrationGateStore.getState().hide();
  migrationGateStore.getState().setDeferredAfterFailure();
  logLibrarySync('[reid] continuing without the update after a failure; retried next launch');
}

/** Re-run after a failure, from the gate's retry button. */
export function retryNavidromeReid(): Promise<void> {
  migrationGateStore.getState().clearFailure();
  return runNavidromeReidIfNeeded();
}

/**
 * @param verdict The decision that triggered this run, captured before the marker moves.
 *   Logging `reidVerdict()` after the fact reports `skip` on every completed pass.
 */
async function execute(verdict: string): Promise<void> {
  const gate = migrationGateStore.getState();
  gate.setDeferred(false);

  /**
   * Take the screen, once. Deliberately NOT called up front: the pre-flight below
   * (foreign-key check, building the id map) is read-only and usually fast, and an
   * install with nothing to re-key would show the interstitial and hide it again — a
   * flash of a screen that had no business appearing. Nothing about the ORDER of the
   * pass changes; only when the screen appears.
   */
  const showGate = (): void => {
    if (!migrationGateStore.getState().visible) migrationGateStore.getState().show('working');
  };

  const db = getDb();
  if (!db) {
    // Fail INTO the gate. Returning silently would let the app launch with the marker
    // still `pending` — and on a resumed run that means rows re-keyed, files half-moved,
    // and `reconcileMusicCacheAsync` reading the store and deleting every moved file as
    // an orphan.
    showGate();
    logLibrarySync('[reid] no database — cannot run');
    gate.fail();
    return;
  }

  setReidState('pending');

  // An ETL that started before the gate went up is still running, and its writes carry
  // `fromMigration` so the write guard lets them through. Left alone it would keep
  // upserting retired-id blob rows straight through `discardLibrary` below and past the
  // completion stamp. `runDataModelUpgradeIfNeeded` refuses to START while the gate is
  // visible; this closes the other direction.
  const etl = dataModelUpgradeInFlight();
  if (etl) {
    // Minutes, potentially — the one pre-flight step the user must be told about.
    showGate();
    // Given its own stage, mirroring the upgrade's own counter. On a large library this
    // wait is minutes long, and a spinner on "Preparing" with nothing moving reads as a
    // hang — the user has no way to tell it is deliberately holding for another job.
    const mirror = () => {
      const sync = syncStatusStore.getState();
      const live = migrationGateStore.getState();
      if (live.stages.waitingForTasks?.total !== sync.normalizedMigrationTotal) {
        live.beginStage('waitingForTasks', sync.normalizedMigrationTotal);
      }
      live.advanceStage('waitingForTasks', sync.normalizedMigrationDone);
    };
    // `mirror` opens the stage itself on its first call (the stored total starts
    // undefined and never matches), so there is no separate beginStage here.
    mirror();
    const unsubscribe = syncStatusStore.subscribe(mirror);
    logLibrarySync('[reid] waiting for the blob ETL to finish before touching the library');
    try {
      await etl;
    } finally {
      unsubscribe();
    }
  }

  // A store hydration converting legacy download metadata reads rows and writes them back
  // by key; a conversion read before the re-key would write retired artist and album ids
  // back after it. No new hydration starts while the gate holds startup.
  await legacyMetadataConversionInFlight();

  try {
    // Prove the deferral works on THIS build before writing anything. The spike that
    // justified the design ran a different SQLite; if a future op-SQLite bump ever changes
    // the behaviour, the pass must refuse rather than corrupt.
    if (!(await verifyDeferredForeignKeys(db))) {
      showGate();
      logLibrarySync('[reid] deferred foreign keys unsupported — refusing to run');
      gate.fail();
      return;
    }

    await createIdMap(db);
    const pairs = await buildIdMap(db);
    logLibrarySync(`[reid] map built: ${pairs} ids change`);

    // NO early exit on an empty map. The map is built from plain, non-artwork columns,
    // and three of the pass's rewriters do not use it at all — artwork tokens, JSON
    // envelopes and KV blobs all go through `canonicalId` directly, precisely because
    // they hold ids that exist in no column. Returning here on `pairs === 0` skipped all
    // three, and a completed scrobble whose id lived only in `song_json` kept a retired
    // id while the marker said complete. It also skipped `discardLibrary`, the only
    // caller of `resetLibrarySync()`, so a stale library was never refilled.
    //
    // Zero pairs is not a special case: the map-driven steps are correct no-ops at zero
    // (`moveDownloadedFiles` returns early on an empty map), and clearing the player and
    // download queues is what this pass is SUPPOSED to do, not collateral damage.
    showGate();
    gate.beginStage('preparing');

    // Only now that we know there IS work. Clearing these above the early exit destroyed
    // the saved queue and every queued download for anyone already canonical — a fresh
    // sign-in on 0.64, or anyone who had re-synced.
    //
    // The IMAGE queue goes with them, and up here rather than in `refreshArtwork`: every
    // row in it names a retired id, and `cancelImageRefreshCycle` only drops rows of the
    // ACTIVE cycle, so anything queued outside one would survive and be retried against
    // ids the server no longer has. Clearing before the cache is cleared also means the
    // re-warm enqueues into an empty queue, so none of its ids collide.
    // Quiet the running app before the first write. A download reconcile already walking
    // reads the store and would delete moved files as orphans, so it finishes first; then
    // the download workers stop, and the player stops and forgets its queue (in memory
    // too, or the persisted queue writer would put the retired ids back).
    await musicCacheReconcileInFlight();
    haltDownloadWorkers();
    await clearQueue();

    // From here on the run writes. A failure after this point cannot be walked away from:
    // the database ends up re-keyed with files still at their old paths, and launching the
    // app into that lets `reconcileMusicCacheAsync` delete every download as an orphan.
    gate.markWritten();

    // After `clearQueue()`: its own snapshot delete is not awaited, and a queue write
    // already in flight could land behind it.
    await clearLiveQueue(db);
    await clearDownloadQueue(db);
    await clearImageQueue();

    gate.beginStage('updatingDownloads');
    await rekeyPlainColumns(db);
    const superseded = await deleteSupersededRows(db);
    const embedded = await rekeyEmbeddedIds(db, (done, total) => {
      // getState() each time: `gate` is a snapshot taken before any set(), so its
      // `stages` never changes and the guard below would always fire.
      const live = migrationGateStore.getState();
      if (live.stages.updatingDownloads?.total !== total) {
        live.beginStage('updatingDownloads', total);
      }
      live.advanceStage('updatingDownloads', done);
    });
    logLibrarySync(`[reid] database re-keyed (${superseded} superseded rows removed)`);

    gate.beginStage('movingFiles');
    const files = await moveDownloadedFiles(db, (done, total) => {
      const live = migrationGateStore.getState();
      if (live.stages.movingFiles?.total !== total) live.beginStage('movingFiles', total);
      live.advanceStage('movingFiles', done);
    });
    logLibrarySync(
      `[reid] files: ${files.moved} moved, ${files.missing} missing, ${files.failed} failed`,
    );
    // A file left at its old path has a row pointing at the new one, so the next
    // reconcile deletes it as an orphan. The move is idempotent, so failing here and
    // retrying next launch costs nothing and saves the track.
    if (files.failed > 0) throw new Error(`${files.failed} file(s) could not be moved`);

    // Discard the library and reset the sync. This has to happen BEFORE the stores
    // rehydrate and before `rebuildTrackMaps`: the track-map populate ends with a starred
    // sync that reads `favorite_songs` from SQL, and if those rows still held retired ids
    // while the store had just been rehydrated to canonical ones, the zero overlap would
    // tear down the whole starred download.
    const cleared = await discardLibrary(db);
    // Stamp the blob-to-SQL ETL complete, and PROVE it stuck.
    //
    // The pass has just discarded the library that ETL imports into, and the legacy blob
    // tables survive the migration chain — so if this key is missing afterwards the idle
    // orchestrator re-imports the entire pre-re-key library on top of the canonical one.
    // That is the doubled-library bug, and it is silent: `kvStorage.setItem` swallowed
    // its own failures, so the write could vanish while the pass reported success.
    //
    // Read back rather than trust the write. Failing here leaves the marker `pending`,
    // so the next launch re-runs an idempotent pass — which is strictly better than
    // completing into a library half in retired ids.
    // Written through the handle this pass already holds rather than `kvStorage`, purely
    // so the read-back below uses the same path as the write. Both worked once the real
    // cause was fixed — the recovery batch in `runAtomicBatchAsync` was rolling this write
    // back (see `db/client.ts`), which is why it failed through either route.
    await db.runAsync(
      'INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?);',
      [MIGRATION_DONE_KEY, MIGRATION_VERSION],
    );
    const stamped = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM storage WHERE key = ?;', [MIGRATION_DONE_KEY],
    );
    if (stamped?.value !== MIGRATION_VERSION) {
      throw new Error(
        `ETL completion key did not persist (wrote "${MIGRATION_VERSION}", read "${stamped?.value ?? null}")`,
      );
    }
    logLibrarySync(`[reid] library discarded (${cleared} tables) — one sync will refill it`);

    // The KV blobs that survive the migration chain. Done before the stores rehydrate, so
    // the rehydrate reads the corrected values rather than writing stale ones back.
    const kvMoved = await rekeyKvBlobs();

    gate.beginStage('finishing');
    // The stores still hold old ids in memory. Until they are rehydrated, any store-driven
    // write puts them straight back into SQL, and `reconcileMusicCacheAsync` — which reads
    // the store, not SQL — would treat every moved file as an orphan.
    const rehydration = await rehydrateAllStores();
    if (rehydration.failed.some((f) => f.store === 'musicCache')) {
      // Without it `hasHydrated` stays false, the track maps build empty and never latch,
      // and every download reads as unavailable — with the marker already stamped.
      throw new Error('music cache failed to rehydrate');
    }
    // `rehydrateAllStores` covers the row-backed stores only; its own header says the
    // kvStorage-backed ones are not included, and both of these hold re-keyed ids.
    await ratingStore.persist.rehydrate();
    await syncStatusStore.persist.rehydrate();
    await rebuildTrackMaps();

    // AFTER the rehydrate, not before. `downloadedCoverArtIds()` reads `musicCacheStore`,
    // and that set is the downloaded-item exemption in `purgeCoverArtRows` — run against
    // stale pre-re-key state, a failed download during the re-warm could purge a
    // downloaded item's cover rows with its protection silently inactive.
    gate.beginStage('refreshingArtwork');
    await refreshArtwork();

    await dropIdMap(db);
    setReidState('complete');
    logLibrarySync('[reid] complete');
    appendReidLog('complete', [
      // Three separate counts on purpose. `pairs` only ever covered the id map, so a
      // run that re-keyed an envelope reported "ids re-keyed: 0" — which is how a real
      // defect was read as a no-op. A log nobody can trust is worse than no log.
      `ids re-keyed     : ${pairs} (plain columns)`,
      `rows rewritten   : ${embedded} (artwork tokens + embedded json)`,
      `kv ids moved     : ${kvMoved}`,
      `superseded rows  : ${superseded}`,
      `files moved      : ${files.moved} (missing ${files.missing}, failed ${files.failed})`,
      `tables discarded : ${cleared}`,
    ], verdict);
    // Buffered behind a 2s timer and nothing wires a flush to AppState, so without this
    // the lines explaining a run are exactly the ones an app kill loses.
    await flushLibrarySyncLog();
    gate.complete();
  } catch (e) {
    // The marker stays `pending`, so the next launch re-enters the interstitial and
    // repeats from the top. Every step is idempotent, so that is safe.
    logLibrarySync(`[reid] failed: ${e instanceof Error ? e.message : String(e)}`);
    appendReidLog('FAILED', [`error: ${e instanceof Error ? e.message : String(e)}`], verdict);
    await flushLibrarySyncLog();
    showGate();
    gate.fail();
  }
}

/**
 * Clear the saved player queue.
 *
 * A queue of retired ids is the symptom that started all of this — restoring one puts the
 * player straight into the failure the pass exists to fix. Bookmarks are deliberately not
 * touched: they are re-keyed like everything else.
 */
async function clearLiveQueue(db: ReturnType<typeof getDb>): Promise<void> {
  if (!db) return;
  await db.runAsync("DELETE FROM queue_snapshots WHERE id = 'live'");
}

/**
 * Empty the download queue.
 *
 * It holds work not yet done, so re-keying seven tables of it buys nothing the user
 * cannot get by queueing again. Completed downloads live in `cached_*` and are re-keyed.
 */
async function clearDownloadQueue(db: ReturnType<typeof getDb>): Promise<void> {
  if (!db) return;
  await db.runAsync('DELETE FROM download_queue');
}

/**
 * Clear the image cache and queue a re-warm for downloaded covers.
 *
 * `clearImageCache` alone is not enough: it deletes `cached_images` and nothing else, so
 * `image_download_queue` rows and the queue meta survive on retired ids — and a live
 * `cycleId` makes the re-warm return early as "cycle already active". `reinit: false`
 * because re-initialising re-arms a foreground subscription we do not want during the
 * pass.
 */
async function refreshArtwork(): Promise<void> {
  // Drop any in-flight cycle FIRST: it clears both the queue rows and the cycle metadata,
  // and a surviving `cycleId` would block every future refresh.
  await cancelImageRefreshCycle();
  await clearImageCache({ reinit: false });

  // The pass's final task: put the downloaded covers back before letting go of the
  // screen. Everything else about a download survives — the files moved, the rows were
  // re-keyed — but the cache was just cleared, and cover art otherwise only returns when
  // some surface happens to render it. Measured on a real device: no downloaded playlist
  // cover came back at all, and the only albums that did were the ones the user had
  // scrolled past. Downloads are the one thing that must work offline, so restoring them
  // is part of the pass, not something left to chance later.
  //
  // Safe here specifically: `cached_songs`, `cached_albums` and `cached_playlists` are
  // KEPT_TABLES, so they survive `discardLibrary` above and carry the re-keyed tokens.
  const cycleId = await enqueueImageRefreshCycle('refresh-downloads');
  if (cycleId === null) return;

  const gate = migrationGateStore.getState();
  const mirror = (): void => {
    const q = imageDownloadQueueStore.getState();
    const live = migrationGateStore.getState();
    if (live.stages.refreshingArtwork?.total !== q.cycleTotal) {
      live.beginStage('refreshingArtwork', q.cycleTotal);
    }
    live.advanceStage('refreshingArtwork', q.cycleProcessed);
  };
  mirror();
  const unsubscribe = imageDownloadQueueStore.subscribe(mirror);
  try {
    await processImageQueue();
  } finally {
    unsubscribe();
  }
  gate.advanceStage('refreshingArtwork', imageDownloadQueueStore.getState().cycleProcessed);
}
