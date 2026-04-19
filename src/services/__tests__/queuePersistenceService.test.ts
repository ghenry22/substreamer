jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import { kvStorage } from '../../store/persistence';
import {
  persistQueue,
  persistPositionIfDue,
  flushPosition,
  clearPersistedQueue,
  getPersistedQueue,
  getPersistedPosition,
  resetPersistTimer,
  PERSIST_INTERVAL_MS,
} from '../queuePersistenceService';
import { type Child } from '../subsonicService';

const makeChild = (id: string): Child =>
  ({ id, title: `Song ${id}`, artist: 'Artist', duration: 200 }) as Child;

beforeEach(() => {
  kvStorage.removeItem('substreamer-persisted-queue');
  kvStorage.removeItem('substreamer-persisted-position');
  resetPersistTimer();
});

describe('persistQueue / getPersistedQueue', () => {
  it('round-trips queue data through SQLite', () => {
    const queue = [makeChild('a'), makeChild('b'), makeChild('c')];
    persistQueue(queue, 1);

    const result = getPersistedQueue();
    expect(result).not.toBeNull();
    expect(result!.queue).toHaveLength(3);
    expect(result!.queue[0].id).toBe('a');
    expect(result!.currentTrackIndex).toBe(1);
  });

  it('returns null when nothing persisted', () => {
    expect(getPersistedQueue()).toBeNull();
  });

  it('returns null for empty queue array', () => {
    persistQueue([], 0);
    expect(getPersistedQueue()).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    kvStorage.setItem('substreamer-persisted-queue', '{bad json');
    expect(getPersistedQueue()).toBeNull();
  });

  it('returns null when queue field is not an array', () => {
    kvStorage.setItem(
      'substreamer-persisted-queue',
      JSON.stringify({ queue: 'not-array', currentTrackIndex: 0 }),
    );
    expect(getPersistedQueue()).toBeNull();
  });

  it('overwrites previous queue on re-persist', () => {
    persistQueue([makeChild('a')], 0);
    persistQueue([makeChild('x'), makeChild('y')], 1);

    const result = getPersistedQueue();
    expect(result!.queue).toHaveLength(2);
    expect(result!.queue[0].id).toBe('x');
    expect(result!.currentTrackIndex).toBe(1);
  });
});

describe('persistPositionIfDue / getPersistedPosition', () => {
  it('persists position on first call (timer at 0)', () => {
    const wrote = persistPositionIfDue(42.5, 'track-1');
    expect(wrote).toBe(true);

    const result = getPersistedPosition();
    expect(result).toEqual({ position: 42.5, trackId: 'track-1' });
  });

  it('skips write when called within debounce interval', () => {
    persistPositionIfDue(10, 'track-1');
    const wrote = persistPositionIfDue(20, 'track-1');
    expect(wrote).toBe(false);

    const result = getPersistedPosition();
    expect(result!.position).toBe(10);
  });

  it('writes again after debounce interval elapses', () => {
    persistPositionIfDue(10, 'track-1');

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + PERSIST_INTERVAL_MS + 1);
    const wrote = persistPositionIfDue(50, 'track-1');
    expect(wrote).toBe(true);

    const result = getPersistedPosition();
    expect(result!.position).toBe(50);

    jest.restoreAllMocks();
  });

  it('returns null when no position persisted', () => {
    expect(getPersistedPosition()).toBeNull();
  });

  it('returns null for malformed position JSON', () => {
    kvStorage.setItem('substreamer-persisted-position', 'not-json');
    expect(getPersistedPosition()).toBeNull();
  });
});

describe('flushPosition', () => {
  it('writes immediately regardless of debounce timer', () => {
    persistPositionIfDue(10, 'track-1');

    flushPosition(99, 'track-1');
    const result = getPersistedPosition();
    expect(result).toEqual({ position: 99, trackId: 'track-1' });
  });

  it('resets the debounce timer so next debounced call is skipped', () => {
    flushPosition(50, 'track-1');

    const wrote = persistPositionIfDue(60, 'track-1');
    expect(wrote).toBe(false);
  });
});

describe('clearPersistedQueue', () => {
  it('removes both queue and position data', () => {
    persistQueue([makeChild('a')], 0);
    flushPosition(30, 'a');

    clearPersistedQueue();

    expect(getPersistedQueue()).toBeNull();
    expect(getPersistedPosition()).toBeNull();
  });

  it('resets the debounce timer', () => {
    flushPosition(10, 'track-1');
    clearPersistedQueue();

    const wrote = persistPositionIfDue(20, 'track-2');
    expect(wrote).toBe(true);
  });
});

describe('resetPersistTimer', () => {
  it('allows immediate position write after reset', () => {
    persistPositionIfDue(10, 'track-1');
    const skipped = persistPositionIfDue(20, 'track-1');
    expect(skipped).toBe(false);

    resetPersistTimer();
    const wrote = persistPositionIfDue(30, 'track-1');
    expect(wrote).toBe(true);
  });
});
