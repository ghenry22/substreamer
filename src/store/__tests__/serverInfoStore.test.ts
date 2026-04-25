jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { serverInfoStore, type ServerInfo } from '../serverInfoStore';

const baseInfo: ServerInfo = {
  serverType: 'Navidrome',
  serverVersion: '0.52.0',
  apiVersion: '1.16.1',
  openSubsonic: true,
  extensions: [{ name: 'transcodeOffset', versions: [1] }],
  lastFetchedAt: 999,
  adminRole: true,
  shareRole: true,
  ignoredArticles: null,
};

beforeEach(() => {
  serverInfoStore.getState().clearServerInfo();
});

describe('serverInfoStore', () => {
  it('setServerInfo stores all fields', () => {
    serverInfoStore.getState().setServerInfo(baseInfo);
    const state = serverInfoStore.getState();
    expect(state.serverType).toBe('Navidrome');
    expect(state.serverVersion).toBe('0.52.0');
    expect(state.apiVersion).toBe('1.16.1');
    expect(state.openSubsonic).toBe(true);
    expect(state.extensions).toEqual([{ name: 'transcodeOffset', versions: [1] }]);
    expect(state.lastFetchedAt).toBe(999);
    expect(state.adminRole).toBe(true);
    expect(state.shareRole).toBe(true);
  });

  it('setServerInfo stores role values', () => {
    serverInfoStore.getState().setServerInfo({ ...baseInfo, adminRole: false, shareRole: null });
    const state = serverInfoStore.getState();
    expect(state.adminRole).toBe(false);
    expect(state.shareRole).toBeNull();
  });

  it('setServerInfo falls back to Date.now() when lastFetchedAt is null', () => {
    const before = Date.now();
    serverInfoStore.getState().setServerInfo({ ...baseInfo, lastFetchedAt: null });
    const after = Date.now();
    const ts = serverInfoStore.getState().lastFetchedAt!;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('clearServerInfo resets to initial state', () => {
    serverInfoStore.getState().setServerInfo(baseInfo);
    serverInfoStore.getState().clearServerInfo();
    const state = serverInfoStore.getState();
    expect(state.serverType).toBeNull();
    expect(state.serverVersion).toBeNull();
    expect(state.openSubsonic).toBe(false);
    expect(state.extensions).toEqual([]);
    expect(state.lastFetchedAt).toBeNull();
    expect(state.adminRole).toBeNull();
    expect(state.shareRole).toBeNull();
  });
});
