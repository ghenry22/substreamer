jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');

import { pendingScrobbleStore } from '../pendingScrobbleStore';

beforeEach(() => {
  pendingScrobbleStore.setState({ pendingScrobbles: [] });
});

describe('addScrobble', () => {
  it('adds a valid song to the queue with generated id and time', () => {
    pendingScrobbleStore.getState().addScrobble(
      { id: 's1', title: 'Song' } as any,
      Date.now(),
    );
    const pending = pendingScrobbleStore.getState().pendingScrobbles;
    expect(pending).toHaveLength(1);
    expect(pending[0].song.id).toBe('s1');
    expect(pending[0].id).toBeTruthy();
    expect(pending[0].time).toBeGreaterThan(0);
  });

  it('rejects when song has no id', () => {
    pendingScrobbleStore.getState().addScrobble(
      { title: 'Song' } as any,
      Date.now(),
    );
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('rejects when song has no title', () => {
    pendingScrobbleStore.getState().addScrobble(
      { id: 's1' } as any,
      Date.now(),
    );
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('rejects null song', () => {
    pendingScrobbleStore.getState().addScrobble(null as any, Date.now());
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('adds multiple scrobbles', () => {
    pendingScrobbleStore.getState().addScrobble({ id: 's1', title: 'A' } as any, 1000);
    pendingScrobbleStore.getState().addScrobble({ id: 's2', title: 'B' } as any, 2000);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(2);
  });
});

describe('removeScrobble', () => {
  it('removes a scrobble by id', () => {
    pendingScrobbleStore.getState().addScrobble({ id: 's1', title: 'A' } as any, 1000);
    const id = pendingScrobbleStore.getState().pendingScrobbles[0].id;
    pendingScrobbleStore.getState().removeScrobble(id);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('is a no-op for nonexistent id', () => {
    pendingScrobbleStore.getState().addScrobble({ id: 's1', title: 'A' } as any, 1000);
    pendingScrobbleStore.getState().removeScrobble('nonexistent');
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(1);
  });

  it('only removes the matching scrobble', () => {
    pendingScrobbleStore.getState().addScrobble({ id: 's1', title: 'A' } as any, 1000);
    pendingScrobbleStore.getState().addScrobble({ id: 's2', title: 'B' } as any, 2000);
    const firstId = pendingScrobbleStore.getState().pendingScrobbles[0].id;
    pendingScrobbleStore.getState().removeScrobble(firstId);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(1);
    expect(pendingScrobbleStore.getState().pendingScrobbles[0].song.id).toBe('s2');
  });
});
