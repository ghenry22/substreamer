import { kvStorage } from '../store/persistence';
import { type Child } from './subsonicService';

const QUEUE_KEY = 'substreamer-persisted-queue';
const POSITION_KEY = 'substreamer-persisted-position';
export const PERSIST_INTERVAL_MS = 10_000;

interface PersistedQueue {
  queue: Child[];
  currentTrackIndex: number;
}

interface PersistedPosition {
  position: number;
  trackId: string;
}

let lastPositionPersistTime = 0;

export function persistQueue(
  queue: Child[],
  currentTrackIndex: number,
): void {
  const data: PersistedQueue = { queue, currentTrackIndex };
  kvStorage.setItem(QUEUE_KEY, JSON.stringify(data));
}

export function persistPositionIfDue(
  position: number,
  trackId: string,
): boolean {
  const now = Date.now();
  if (now - lastPositionPersistTime < PERSIST_INTERVAL_MS) return false;
  lastPositionPersistTime = now;
  kvStorage.setItem(
    POSITION_KEY,
    JSON.stringify({ position, trackId } as PersistedPosition),
  );
  return true;
}

export function flushPosition(position: number, trackId: string): void {
  lastPositionPersistTime = Date.now();
  kvStorage.setItem(
    POSITION_KEY,
    JSON.stringify({ position, trackId } as PersistedPosition),
  );
}

export function clearPersistedQueue(): void {
  kvStorage.removeItem(QUEUE_KEY);
  kvStorage.removeItem(POSITION_KEY);
  lastPositionPersistTime = 0;
}

export function getPersistedQueue(): PersistedQueue | null {
  const raw = kvStorage.getItem(QUEUE_KEY) as string | null;
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PersistedQueue;
    if (!Array.isArray(data.queue) || data.queue.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

export function getPersistedPosition(): PersistedPosition | null {
  const raw = kvStorage.getItem(POSITION_KEY) as string | null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedPosition;
  } catch {
    return null;
  }
}

export function resetPersistTimer(): void {
  lastPositionPersistTime = 0;
}
