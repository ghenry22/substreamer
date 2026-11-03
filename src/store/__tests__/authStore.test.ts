jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { authStore } from '../authStore';
import { markLogoutPending } from '../logoutPending';
import { clearKvStorage, kvStorageSync } from '../persistence';

beforeEach(() => {
  authStore.setState({
    serverUrl: null,
    username: null,
    password: null,
    apiVersion: null,
    legacyAuth: false,
    isLoggedIn: false,
    rehydrated: false,
    primaryServerUrl: null,
    secondaryServerUrl: null,
    activeServer: 'primary',
  });
});

describe('authStore', () => {
  it('setSession stores credentials and sets isLoggedIn', () => {
    authStore.getState().setSession('https://music.example.com', 'user', 'pass', '1.16');
    const state = authStore.getState();
    expect(state.serverUrl).toBe('https://music.example.com');
    expect(state.username).toBe('user');
    expect(state.password).toBe('pass');
    expect(state.apiVersion).toBe('1.16');
    expect(state.isLoggedIn).toBe(true);
  });

  it('setSession defaults legacyAuth to false when omitted', () => {
    authStore.getState().setSession('https://music.example.com', 'user', 'pass', '1.16');
    expect(authStore.getState().legacyAuth).toBe(false);
  });

  it('setSession stores legacyAuth when true', () => {
    authStore.getState().setSession('https://music.example.com', 'user', 'pass', '1.16', true);
    expect(authStore.getState().legacyAuth).toBe(true);
  });

  it('setLegacyAuth flips the auth scheme without disturbing the server slots', () => {
    authStore.getState().setSession('https://music.example.com', 'user', 'pass', '1.16');
    authStore.getState().setSecondaryServerUrl('https://backup.example.com');
    authStore.getState().setActiveServer('secondary');

    authStore.getState().setLegacyAuth(true);

    const state = authStore.getState();
    expect(state.legacyAuth).toBe(true);
    // Slots, active server, and credentials are untouched.
    expect(state.primaryServerUrl).toBe('https://music.example.com');
    expect(state.secondaryServerUrl).toBe('https://backup.example.com');
    expect(state.activeServer).toBe('secondary');
    expect(state.serverUrl).toBe('https://backup.example.com');
    expect(state.username).toBe('user');

    authStore.getState().setLegacyAuth(false);
    expect(authStore.getState().legacyAuth).toBe(false);
  });

  it('setRehydrated updates rehydrated flag', () => {
    authStore.getState().setRehydrated(true);
    expect(authStore.getState().rehydrated).toBe(true);
  });

  describe('failover schema', () => {
    it('setSession populates primaryServerUrl and resets activeServer to primary', () => {
      authStore.getState().setSession('https://primary.example.com', 'user', 'pass', '1.16');
      const state = authStore.getState();
      expect(state.serverUrl).toBe('https://primary.example.com');
      expect(state.primaryServerUrl).toBe('https://primary.example.com');
      expect(state.activeServer).toBe('primary');
    });

    it('setSession on top of secondary-active resets back to primary', () => {
      authStore.setState({
        primaryServerUrl: 'https://old-primary.example.com',
        secondaryServerUrl: 'https://secondary.example.com',
        activeServer: 'secondary',
        serverUrl: 'https://secondary.example.com',
      });
      authStore.getState().setSession('https://new-primary.example.com', 'user', 'pass', '1.16');
      const state = authStore.getState();
      expect(state.serverUrl).toBe('https://new-primary.example.com');
      expect(state.primaryServerUrl).toBe('https://new-primary.example.com');
      expect(state.activeServer).toBe('primary');
    });

    it('setSecondaryServerUrl stores the URL', () => {
      authStore.getState().setSecondaryServerUrl('https://secondary.example.com');
      expect(authStore.getState().secondaryServerUrl).toBe('https://secondary.example.com');
    });

    it('setSecondaryServerUrl(null) clears the URL', () => {
      authStore.setState({ secondaryServerUrl: 'https://secondary.example.com' });
      authStore.getState().setSecondaryServerUrl(null);
      expect(authStore.getState().secondaryServerUrl).toBeNull();
    });

    it('setPassword changes only the password', () => {
      authStore.setState({
        serverUrl: 'http://lan.local',
        primaryServerUrl: 'https://remote.example.com',
        secondaryServerUrl: 'http://lan.local',
        activeServer: 'secondary',
        password: 'old',
      });
      authStore.getState().setPassword('new');
      const s = authStore.getState();
      expect(s.password).toBe('new');
      // A password change is not a session change: `setSession` would have rewritten
      // primaryServerUrl from the ACTIVE url, destroying the remote address.
      expect(s.primaryServerUrl).toBe('https://remote.example.com');
      expect(s.secondaryServerUrl).toBe('http://lan.local');
      expect(s.activeServer).toBe('secondary');
      expect(s.serverUrl).toBe('http://lan.local');
    });

    it('setPrimaryServerUrl mirrors into serverUrl when primary is active', () => {
      authStore.setState({
        serverUrl: 'https://old.example.com',
        primaryServerUrl: 'https://old.example.com',
        activeServer: 'primary',
      });
      authStore.getState().setPrimaryServerUrl('https://new.example.com');
      const s = authStore.getState();
      expect(s.primaryServerUrl).toBe('https://new.example.com');
      // Without the mirror the edit is inert — every request path reads `serverUrl`,
      // and setActiveServer no-ops on the already-active slot.
      expect(s.serverUrl).toBe('https://new.example.com');
      expect(s.activeServer).toBe('primary');
    });

    it('setPrimaryServerUrl does NOT switch away from an active secondary', () => {
      authStore.setState({
        serverUrl: 'http://lan.local',
        primaryServerUrl: 'https://old.example.com',
        secondaryServerUrl: 'http://lan.local',
        activeServer: 'secondary',
      });
      authStore.getState().setPrimaryServerUrl('https://new.example.com');
      const s = authStore.getState();
      expect(s.primaryServerUrl).toBe('https://new.example.com');
      // Re-addressing a slot must not change which one is live — that is failover's job.
      expect(s.serverUrl).toBe('http://lan.local');
      expect(s.activeServer).toBe('secondary');
    });

    it('setSecondaryServerUrl mirrors into serverUrl when secondary is active', () => {
      authStore.setState({
        serverUrl: 'http://old.lan',
        secondaryServerUrl: 'http://old.lan',
        activeServer: 'secondary',
      });
      authStore.getState().setSecondaryServerUrl('http://new.lan');
      expect(authStore.getState().serverUrl).toBe('http://new.lan');
    });

    it('setSecondaryServerUrl(null) never nulls serverUrl, even while active', () => {
      // Mirroring a CLEAR would write serverUrl: null — a persisted field that every
      // request path treats as "no session", leaving the app unusable short of logout.
      authStore.setState({
        serverUrl: 'http://lan.local',
        primaryServerUrl: 'https://remote.example.com',
        secondaryServerUrl: 'http://lan.local',
        activeServer: 'secondary',
      });
      authStore.getState().setSecondaryServerUrl(null);
      const s = authStore.getState();
      expect(s.secondaryServerUrl).toBeNull();
      expect(s.serverUrl).toBe('http://lan.local');
    });

    it('setActiveServer(secondary) updates serverUrl to secondary URL', () => {
      authStore.setState({
        primaryServerUrl: 'https://primary.example.com',
        secondaryServerUrl: 'https://secondary.example.com',
        serverUrl: 'https://primary.example.com',
        activeServer: 'primary',
      });
      authStore.getState().setActiveServer('secondary');
      const state = authStore.getState();
      expect(state.activeServer).toBe('secondary');
      expect(state.serverUrl).toBe('https://secondary.example.com');
    });

    it('setActiveServer(primary) swaps back from secondary', () => {
      authStore.setState({
        primaryServerUrl: 'https://primary.example.com',
        secondaryServerUrl: 'https://secondary.example.com',
        serverUrl: 'https://secondary.example.com',
        activeServer: 'secondary',
      });
      authStore.getState().setActiveServer('primary');
      const state = authStore.getState();
      expect(state.activeServer).toBe('primary');
      expect(state.serverUrl).toBe('https://primary.example.com');
    });

    it('setActiveServer is a no-op if target slot has no URL', () => {
      authStore.setState({
        primaryServerUrl: 'https://primary.example.com',
        secondaryServerUrl: null,
        serverUrl: 'https://primary.example.com',
        activeServer: 'primary',
      });
      authStore.getState().setActiveServer('secondary');
      const state = authStore.getState();
      expect(state.activeServer).toBe('primary');
      expect(state.serverUrl).toBe('https://primary.example.com');
    });

    it('setActiveServer is a no-op if already on the target slot', () => {
      authStore.setState({
        primaryServerUrl: 'https://primary.example.com',
        serverUrl: 'https://primary.example.com',
        activeServer: 'primary',
      });
      authStore.getState().setActiveServer('primary');
      expect(authStore.getState().activeServer).toBe('primary');
    });
  });
});


describe('authStore hydration with a logout pending', () => {
  beforeEach(() => {
    clearKvStorage();
    kvStorageSync.setItem('substreamer-auth', JSON.stringify({
      state: { serverUrl: 'https://music.example.com', username: 'old', password: 'p', isLoggedIn: true },
      version: 0,
    }));
  });
  afterEach(() => clearKvStorage());

  it('hydrates logged out, and the actions still work', async () => {
    markLogoutPending();
    await authStore.persist.rehydrate();

    expect(authStore.getState().isLoggedIn).toBe(false);
    expect(authStore.getState().username).toBeNull();
    authStore.getState().setSession('https://new.example.com', 'new', 'q', '1.16');
    expect(authStore.getState().username).toBe('new');
  });

  it('hydrates the persisted session when no logout is pending', async () => {
    await authStore.persist.rehydrate();

    expect(authStore.getState().isLoggedIn).toBe(true);
    expect(authStore.getState().username).toBe('old');
  });
});
