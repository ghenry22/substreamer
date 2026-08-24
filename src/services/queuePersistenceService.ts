// The LIVE player queue, persisted as the `SNAPSHOT_LIVE_ID` row pair.
//
// The write is SPLIT: a track change or a position tick moves the cursor with ONE
// UPDATE on the parent row, and only a queue CHANGE rewrites the songs — debounced
// so a burst of skips collapses into one write, forced out by
// `flushPersistedQueue()` when the app backgrounds.
//
// `liveQueue`/`liveIndex`/`livePosition` are the in-memory truth every writer reads;
// the first read of the session seeds them from the stored row. The stored position
// always belongs to the track under the cursor, because moving the cursor onto a
// different track zeroes it.
import {
  deleteSnapshot,
  readSnapshotSync,
  replaceSnapshotTracks,
  updateSnapshotIndex,
  upsertSnapshot,
  SNAPSHOT_LIVE_ID,
} from '../store/persistence/queueSnapshotTable';
import { type Child } from './subsonicService';
import type { QueueTrackOrigin } from '../types/queue';

/** Throttle window for resume-position writes. */
const PERSIST_INTERVAL_MS = 10_000;

/**
 * Debounce window for queue-CHANGE writes. A queue change rewrites every song row,
 * so a short trailing debounce collapses a burst (rapid skips that also add or prune
 * tracks, a batch of queue edits) into one batch, off the JS thread. The stored copy
 * only needs to be current for crash/relaunch restore, so a ~1.5s lag is fine —
 * `flushPersistedQueue()` forces it out on backgrounding. Track changes do NOT wait
 * on this: they are one UPDATE and go out immediately.
 */
const QUEUE_DEBOUNCE_MS = 1500;

interface PersistedQueue {
  queue: Child[];
  currentTrackIndex: number;
  origins: QueueTrackOrigin[];
}

interface PersistedPosition {
  position: number;
  trackId: string;
}

/* ------------------------------------------------------------------ */
/*  In-memory truth                                                    */
/* ------------------------------------------------------------------ */

let liveQueue: Child[] = [];
let liveOrigins: QueueTrackOrigin[] = [];
let liveIndex = 0;
let livePosition = 0;
let livePositionTrackId: string | null = null;
/** True once memory is authoritative — after the first read or any write. */
let liveLoaded = false;
/** True while a queue change is waiting on the debounce, i.e. the song rows are
 *  stale. The cursor writers defer to the pending flush rather than racing it. */
let queueDirty = false;

let lastPositionPersistTime = 0;
let queueTimer: ReturnType<typeof setTimeout> | null = null;

/** Seed memory from the stored row, once per process — the cold-start restore. */
function ensureLoaded(): void {
  if (liveLoaded) return;
  liveLoaded = true;
  const snapshot = readSnapshotSync(SNAPSHOT_LIVE_ID);
  if (snapshot === null || snapshot.tracks.length === 0) return;
  liveQueue = snapshot.tracks;
  liveOrigins = snapshot.origins;
  liveIndex = Math.min(Math.max(0, snapshot.currentIndex), snapshot.tracks.length - 1);
  livePosition = snapshot.positionSec ?? 0;
  livePositionTrackId = liveQueue[liveIndex]?.id ?? null;
}

/**
 * Move the cursor in memory. The stored position is an offset INTO the track under
 * the cursor, so landing on a different track voids it.
 */
function setCursor(queue: Child[], index: number, origins = liveOrigins): void {
  const previousTrackId = liveQueue[liveIndex]?.id;
  liveLoaded = true;
  liveQueue = queue;
  liveOrigins = origins.length === queue.length ? [...origins] : queue.map(() => 'manual');
  liveIndex = index;
  const nextTrackId = queue[index]?.id;
  if (nextTrackId !== previousTrackId) {
    livePosition = 0;
    livePositionTrackId = nextTrackId ?? null;
  }
}

function clearQueueTimer(): void {
  if (queueTimer !== null) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

/** Write the parent row then the songs — the songs FK to the parent, so the upsert
 *  has to land first. Each op swallows its own failures. */
function flushQueueWrite(): void {
  clearQueueTimer();
  if (!queueDirty) return;
  queueDirty = false;
  const tracks = liveQueue;
  const origins = liveOrigins;
  const meta = {
    id: SNAPSHOT_LIVE_ID,
    kind: 'live' as const,
    name: null,
    createdAt: Date.now(),
    currentIndex: liveIndex,
    positionSec: livePosition,
  };
  void (async () => {
    await upsertSnapshot(meta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, tracks, origins);
  })();
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

/** Record a queue CHANGE — tracks added, removed, reordered or replaced. Rewrites
 *  every song row, so it is debounced; readers see the new queue immediately. */
export function persistQueue(
  queue: Child[],
  currentTrackIndex: number,
  origins?: readonly QueueTrackOrigin[],
): void {
  setCursor(queue, currentTrackIndex, origins ? [...origins] : queue.map(() => 'manual'));
  queueDirty = true;
  clearQueueTimer();
  queueTimer = setTimeout(flushQueueWrite, QUEUE_DEBOUNCE_MS);
}

/**
 * Record a track change: ONE UPDATE on the parent row, the songs untouched — this is
 * the hot path. When a queue change is still inside its debounce window the pending
 * flush carries the new cursor instead, so the cursor can never land on rows that
 * have not been written yet.
 */
export function persistCurrentIndex(currentTrackIndex: number): void {
  setCursor(liveQueue, currentTrackIndex);
  if (queueDirty) return;
  void updateSnapshotIndex(SNAPSHOT_LIVE_ID, liveIndex, livePosition);
}

/** Force the pending queue change out now (e.g. on app background). */
export function flushPersistedQueue(): void {
  flushQueueWrite();
}

/**
 * A persisted resume position must be a valid in-track offset. Clamp to
 * [0, duration] when the duration is known so we never store a position past
 * the end of the track (which would seek to an invalid spot on next launch).
 */
function clampPersistedPosition(position: number, duration?: number): number {
  const floored = Math.max(0, position);
  return duration != null && duration > 0 ? Math.min(floored, duration) : floored;
}

function setPosition(position: number, trackId: string, duration?: number): void {
  liveLoaded = true;
  livePosition = clampPersistedPosition(position, duration);
  livePositionTrackId = trackId;
}

/** Store the resume position at most once per {@link PERSIST_INTERVAL_MS}. Returns
 *  whether it wrote. Folded into the parent row, alongside the cursor it belongs to. */
export function persistPositionIfDue(
  position: number,
  trackId: string,
  duration?: number,
): boolean {
  const now = Date.now();
  if (now - lastPositionPersistTime < PERSIST_INTERVAL_MS) return false;
  lastPositionPersistTime = now;
  setPosition(position, trackId, duration);
  // A queue change inside its debounce window carries the position out with it.
  if (!queueDirty) void updateSnapshotIndex(SNAPSHOT_LIVE_ID, liveIndex, livePosition);
  return true;
}

/** Store the resume position now, ignoring the throttle. */
export function flushPosition(position: number, trackId: string, duration?: number): void {
  lastPositionPersistTime = Date.now();
  setPosition(position, trackId, duration);
  // "Flush" means now: a pending queue change goes out with it, not after it.
  if (queueDirty) flushQueueWrite();
  else void updateSnapshotIndex(SNAPSHOT_LIVE_ID, liveIndex, livePosition);
}

export function clearPersistedQueue(): void {
  // Cancel any pending queue write so it can't land after the removal.
  clearQueueTimer();
  queueDirty = false;
  liveLoaded = true;
  liveQueue = [];
  liveOrigins = [];
  liveIndex = 0;
  livePosition = 0;
  livePositionTrackId = null;
  lastPositionPersistTime = 0;
  void deleteSnapshot(SNAPSHOT_LIVE_ID);
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

/**
 * The queue to restore, SYNCHRONOUSLY — `restorePersistedQueue` seeds the store on
 * the JS thread so the mini player paints immediately. The `Child` objects are whole:
 * a restored queue becomes the scrobble write path's source.
 */
export function getPersistedQueue(): PersistedQueue | null {
  ensureLoaded();
  if (liveQueue.length === 0) return null;
  return { queue: liveQueue, currentTrackIndex: liveIndex, origins: liveOrigins };
}

/** The resume position and the track it was measured on. */
export function getPersistedPosition(): PersistedPosition | null {
  ensureLoaded();
  if (livePositionTrackId === null) return null;
  return { position: livePosition, trackId: livePositionTrackId };
}
