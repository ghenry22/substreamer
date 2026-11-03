jest.mock('../../../store/persistence/kvStorage', () =>
  require('../../../store/persistence/__mocks__/kvStorage'),
);
jest.mock('../../subsonicService', () => ({ getApi: () => null }));

let mockHealthy = true;
jest.mock('../../../store/persistence', () => ({
  ...jest.requireActual('../../../store/persistence'),
  isDbHealthy: () => mockHealthy,
}));

const mockWipe = jest.fn(async () => {
  mockDb().runSync('DELETE FROM albums');
});
jest.mock('../../../store/resetAllStores', () => ({
  wipeServerData: () => mockWipe(),
}));

import { ensureNormalizedSchema } from '../../../db/createNormalizedTables';
import { kvStorageSync } from '../../../store/persistence';
import { getDb } from '../../../store/persistence/db';
import { serverInfoStore } from '../../../store/serverInfoStore';
import { syncStatusStore } from '../../../store/syncStatusStore';
import { installHoldsServerIds } from '../reidInstall';
import {
  clearReidMarker,
  isReidComplete,
  markServerAnswered,
  reidVerdict,
  setLegacyThisSession,
  isLegacyThisSession,
  setProbedVersion,
  shouldBlockLibraryWrites,
} from '../reidMarker';
import { beginReidSession } from '../reidSession';

function mockDb() {
  return getDb()!;
}

const NAVIDROME_064 = { serverType: 'navidrome', serverVersion: '0.64.0 (1072e9f7)' };

beforeAll(() => ensureNormalizedSchema(mockDb()));

beforeEach(() => {
  mockHealthy = true;
  mockWipe.mockClear();
  mockDb().runSync('DELETE FROM albums');
  clearReidMarker();
  serverInfoStore.setState({ serverType: null, serverVersion: null });
});

describe('beginReidSession', () => {
  it('marks an empty install on 0.64 or later as done and leaves writes open', async () => {
    await beginReidSession(NAVIDROME_064);

    expect(isReidComplete()).toBe(true);
    expect(shouldBlockLibraryWrites()).toBe(false);
    expect(mockWipe).not.toHaveBeenCalled();
  });

  it('keeps writes open when the server details arrive after login (the reported bug)', async () => {
    // Fresh install: the splash had no server to ask. Without the login-time decision,
    // the details landing mid-session closed the gate and refused every library write.
    await beginReidSession(NAVIDROME_064);
    serverInfoStore.setState({ serverType: 'navidrome', serverVersion: '0.64.0 (1072e9f7)' });

    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('records the server identity before the session starts', async () => {
    await beginReidSession(NAVIDROME_064);

    expect(serverInfoStore.getState().serverType).toBe('navidrome');
    expect(serverInfoStore.getState().serverVersion).toBe('0.64.0 (1072e9f7)');
  });

  it('does not stamp a server below 0.64, and leaves writes open', async () => {
    await beginReidSession({ serverType: 'navidrome', serverVersion: '0.63.2 (abc1234)' });

    expect(isReidComplete()).toBe(false);
    expect(reidVerdict()).toBe('skip');
    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('takes an undetermined version as given on an empty install: no prompt, no stamp', async () => {
    await beginReidSession({ serverType: 'navidrome', serverVersion: 'dev' });

    expect(isReidComplete()).toBe(false);
    expect(reidVerdict()).toBe('ask');
    expect(isLegacyThisSession()).toBe(true);
  });

  it('leaves an undetermined version to the prompt when leftovers survive the wipe', async () => {
    mockDb().runSync("INSERT INTO albums (id, name, sort_title) VALUES ('old', 'Old', 'old')");
    mockWipe.mockImplementationOnce(async () => undefined);

    await beginReidSession({ serverType: 'navidrome', serverVersion: 'dev' });

    expect(isLegacyThisSession()).toBe(false);
  });

  it('leaves a non-Navidrome server alone', async () => {
    await beginReidSession({ serverType: 'gonic', serverVersion: '0.16.4' });

    expect(isReidComplete()).toBe(false);
    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('wipes leftovers from the previous session first, then stamps', async () => {
    mockDb().runSync("INSERT INTO albums (id, name, sort_title) VALUES ('old', 'Old', 'old')");
    const resetLibrarySync = jest.fn();
    const resetSongSync = jest.fn();
    syncStatusStore.setState({ resetLibrarySync, resetSongSync } as never);

    await beginReidSession(NAVIDROME_064);

    expect(mockWipe).toHaveBeenCalledTimes(1);
    expect(resetLibrarySync).toHaveBeenCalled();
    expect(resetSongSync).toHaveBeenCalled();
    expect(isReidComplete()).toBe(true);
    syncStatusStore.setState(syncStatusStore.getInitialState(), true);
  });

  it('wipes leftovers whatever the server version', async () => {
    mockDb().runSync("INSERT INTO albums (id, name, sort_title) VALUES ('old', 'Old', 'old')");

    await beginReidSession({ serverType: 'navidrome', serverVersion: '0.63.2' });

    expect(mockWipe).toHaveBeenCalledTimes(1);
    expect(isReidComplete()).toBe(false);
  });

  it('never stamps over a wipe that did not take', async () => {
    mockDb().runSync("INSERT INTO albums (id, name, sort_title) VALUES ('old', 'Old', 'old')");
    mockWipe.mockImplementationOnce(async () => undefined);

    await beginReidSession(NAVIDROME_064);

    expect(isReidComplete()).toBe(false);
  });

  it('changes nothing when the database is unavailable', async () => {
    mockHealthy = false;
    mockDb().runSync("INSERT INTO albums (id, name, sort_title) VALUES ('old', 'Old', 'old')");

    await beginReidSession(NAVIDROME_064);

    expect(mockWipe).not.toHaveBeenCalled();
    expect(isReidComplete()).toBe(false);
  });

  it('starts the session without a stamp when the marker cannot be written', async () => {
    const setItem = jest.spyOn(kvStorageSync, 'setItem').mockImplementation(() => {
      throw new Error('disk full');
    });
    try {
      await expect(beginReidSession(NAVIDROME_064)).resolves.toBeUndefined();
      expect(isReidComplete()).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  it('forgets the previous session: an earlier 0.63 answer does not decide this one', async () => {
    setProbedVersion('0.63.2');
    markServerAnswered();
    setLegacyThisSession();

    await beginReidSession(NAVIDROME_064);

    expect(isLegacyThisSession()).toBe(false);
    expect(isReidComplete()).toBe(true);
  });
});

describe('installHoldsServerIds', () => {
  it('is false on a freshly created schema', async () => {
    expect(await installHoldsServerIds(mockDb())).toBe(false);
  });

  it('is true when any server table has a row', async () => {
    mockDb().runSync("INSERT INTO albums (id, name, sort_title) VALUES ('a', 'A', 'a')");
    expect(await installHoldsServerIds(mockDb())).toBe(true);
  });

  it('ignores the KV store', async () => {
    mockDb().runSync("INSERT OR REPLACE INTO storage (key, value) VALUES ('substreamer-auth', '{}')");
    expect(await installHoldsServerIds(mockDb())).toBe(false);
  });
});
