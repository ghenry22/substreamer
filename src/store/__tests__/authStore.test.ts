jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { authStore } from '../authStore';

beforeEach(() => {
  authStore.setState({
    serverUrl: null,
    username: null,
    password: null,
    apiVersion: null,
    legacyAuth: false,
    isLoggedIn: false,
    rehydrated: false,
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

  it('clearSession resets all credentials', () => {
    authStore.getState().setSession('https://music.example.com', 'user', 'pass', '1.16', true);
    authStore.getState().clearSession();
    const state = authStore.getState();
    expect(state.serverUrl).toBeNull();
    expect(state.username).toBeNull();
    expect(state.password).toBeNull();
    expect(state.apiVersion).toBeNull();
    expect(state.legacyAuth).toBe(false);
    expect(state.isLoggedIn).toBe(false);
  });

  it('setRehydrated updates rehydrated flag', () => {
    authStore.getState().setRehydrated(true);
    expect(authStore.getState().rehydrated).toBe(true);
  });
});

