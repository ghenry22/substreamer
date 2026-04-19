jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { backupStore, migrateBackupState } from '../backupStore';
import { kvStorage } from '../persistence';

const PERSIST_KEY = 'substreamer-backup-settings';

beforeEach(() => {
  backupStore.setState({
    autoBackupEnabled: true,
    lastBackupTimes: {},
  });
});

describe('backupStore', () => {
  it('setAutoBackupEnabled to false', () => {
    backupStore.getState().setAutoBackupEnabled(false);
    expect(backupStore.getState().autoBackupEnabled).toBe(false);
  });

  it('setAutoBackupEnabled to true', () => {
    backupStore.setState({ autoBackupEnabled: false });
    backupStore.getState().setAutoBackupEnabled(true);
    expect(backupStore.getState().autoBackupEnabled).toBe(true);
  });

  it('setLastBackupTime stores time for identity key', () => {
    backupStore.getState().setLastBackupTime('https://server.com|user', 1234567890);
    expect(backupStore.getState().lastBackupTimes['https://server.com|user']).toBe(1234567890);
  });

  it('getLastBackupTime returns null for unknown key', () => {
    expect(backupStore.getState().getLastBackupTime('unknown-key')).toBeNull();
  });

  it('getLastBackupTime returns stored time for known key', () => {
    backupStore.getState().setLastBackupTime('key-a', 9999);
    expect(backupStore.getState().getLastBackupTime('key-a')).toBe(9999);
  });

  it('stores multiple identity keys independently', () => {
    backupStore.getState().setLastBackupTime('key-a', 1000);
    backupStore.getState().setLastBackupTime('key-b', 2000);

    expect(backupStore.getState().getLastBackupTime('key-a')).toBe(1000);
    expect(backupStore.getState().getLastBackupTime('key-b')).toBe(2000);
  });

  it('updating one key does not affect another', () => {
    backupStore.getState().setLastBackupTime('key-a', 1000);
    backupStore.getState().setLastBackupTime('key-b', 2000);
    backupStore.getState().setLastBackupTime('key-a', 3000);

    expect(backupStore.getState().getLastBackupTime('key-a')).toBe(3000);
    expect(backupStore.getState().getLastBackupTime('key-b')).toBe(2000);
  });

  it('migrateBackupState converts v0 lastBackupTime to lastBackupTimes', () => {
    const result = migrateBackupState(
      { autoBackupEnabled: true, lastBackupTime: 9999 },
      0,
    );
    expect(result).toEqual({ autoBackupEnabled: true, lastBackupTimes: {} });
    expect(result.lastBackupTime).toBeUndefined();
  });

  it('migrateBackupState handles undefined version (no version in storage)', () => {
    const result = migrateBackupState(
      { autoBackupEnabled: false, lastBackupTime: 5000 },
      undefined as any,
    );
    expect(result).toEqual({ autoBackupEnabled: false, lastBackupTimes: {} });
  });

  it('migrateBackupState passes through v1 data unchanged', () => {
    const data = { autoBackupEnabled: true, lastBackupTimes: { 'key': 1000 } };
    const result = migrateBackupState(data, 1);
    expect(result).toBe(data);
  });

  it('migrateBackupState returns safe defaults when persisted is null', () => {
    const result = migrateBackupState(null, 0);
    expect(result).toEqual({ autoBackupEnabled: true, lastBackupTimes: {} });
  });

  it('migrateBackupState returns safe defaults when persisted is undefined', () => {
    const result = migrateBackupState(undefined, 1);
    expect(result).toEqual({ autoBackupEnabled: true, lastBackupTimes: {} });
  });

  it('migrateBackupState returns safe defaults when persisted is a non-object', () => {
    const result = migrateBackupState('garbage' as any, 0);
    expect(result).toEqual({ autoBackupEnabled: true, lastBackupTimes: {} });
  });

  it('rehydrates v1 persisted data correctly', async () => {
    kvStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        version: 1,
        state: { autoBackupEnabled: false, lastBackupTimes: { 'key-x': 5000 } },
      }),
    );

    await backupStore.persist.rehydrate();

    const state = backupStore.getState();
    expect(state.autoBackupEnabled).toBe(false);
    expect(state.lastBackupTimes).toEqual({ 'key-x': 5000 });
  });

  it('partializes state correctly (excludes functions)', () => {
    backupStore.getState().setLastBackupTime('key-a', 1000);
    backupStore.getState().setAutoBackupEnabled(false);

    const persisted = kvStorage.getItem(PERSIST_KEY) as string | null;
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted!);
    expect(parsed.state).toEqual({
      autoBackupEnabled: false,
      lastBackupTimes: { 'key-a': 1000 },
    });
    // Functions should not be in persisted state
    expect(parsed.state.setAutoBackupEnabled).toBeUndefined();
    expect(parsed.state.setLastBackupTime).toBeUndefined();
    expect(parsed.state.getLastBackupTime).toBeUndefined();
  });
});
