jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

const calls: string[] = [];
const mockResetAllStores = jest.fn();
jest.mock('../../store/resetAllStores', () => ({
  resetAllStores: () => mockResetAllStores(),
}));
jest.mock('../playerService', () => ({
  clearQueue: () => calls.push(`clearQueue pending=${mockPending()}`),
}));
jest.mock('../scanService', () => ({ stopPolling: () => calls.push('stopPolling') }));
jest.mock('../subsonicService', () => ({ clearApiCache: () => calls.push('clearApiCache') }));
jest.mock('../sslTrustService', () => ({
  clearAllNativeTrust: async () => { calls.push('clearAllNativeTrust'); },
}));

import { clearKvStorage } from '../../store/persistence/kvStorage';
import { isLogoutPending, markLogoutPending } from '../../store/logoutPending';
import { finishLogout, logout } from '../logoutService';

function mockPending(): boolean {
  return isLogoutPending();
}

beforeEach(() => {
  calls.length = 0;
  clearKvStorage();
  // The real reset ends with the KV clear, which is what removes the flag.
  mockResetAllStores.mockReset().mockImplementation(async () => {
    calls.push('resetAllStores');
    clearKvStorage();
  });
});

describe('logout', () => {
  it('sets the flag before any teardown, then finishes in order', async () => {
    await logout();

    expect(calls).toEqual([
      'clearQueue pending=true',
      'stopPolling',
      'clearApiCache',
      'clearAllNativeTrust',
      'resetAllStores',
    ]);
    expect(isLogoutPending()).toBe(false);
  });
});

describe('finishLogout', () => {
  it('clears native trust, then resets the stores', async () => {
    markLogoutPending();
    await finishLogout();

    expect(calls).toEqual(['clearAllNativeTrust', 'resetAllStores']);
    expect(isLogoutPending()).toBe(false);
  });

  it('resolves when the reset fails, leaving the flag for the next launch', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('disk I/O error');
    mockResetAllStores.mockRejectedValueOnce(err);
    markLogoutPending();

    await expect(finishLogout()).resolves.toBeUndefined();

    expect(isLogoutPending()).toBe(true);
    expect(warn).toHaveBeenCalledWith('[logout] finishLogout failed:', err);
    expect(warn).toHaveBeenCalledWith('[logout] logout incomplete; it finishes at the next launch');
    warn.mockRestore();
  });
});
