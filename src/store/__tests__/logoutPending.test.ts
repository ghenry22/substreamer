jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { isLogoutPending, markLogoutPending } from '../logoutPending';
import { clearKvStorage } from '../persistence';

afterEach(() => clearKvStorage());

describe('logoutPending', () => {
  it('reads unset on a fresh install', () => {
    expect(isLogoutPending()).toBe(false);
  });

  it('reads set once marked', () => {
    markLogoutPending();
    expect(isLogoutPending()).toBe(true);
  });

  it('is removed by the KV clear', async () => {
    markLogoutPending();
    await clearKvStorage();
    expect(isLogoutPending()).toBe(false);
  });
});
