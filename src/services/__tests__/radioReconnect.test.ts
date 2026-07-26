import {
  RADIO_RECONNECT_MAX_ATTEMPTS,
  radioReconnectDelayMs,
  shouldRadioReconnect,
} from '../radioReconnect';

describe('shouldRadioReconnect', () => {
  it('allows reconnects below the cap and stops at it', () => {
    expect(shouldRadioReconnect(0)).toBe(true);
    expect(shouldRadioReconnect(RADIO_RECONNECT_MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRadioReconnect(RADIO_RECONNECT_MAX_ATTEMPTS)).toBe(false);
    expect(shouldRadioReconnect(RADIO_RECONNECT_MAX_ATTEMPTS + 3)).toBe(false);
  });
});

describe('radioReconnectDelayMs', () => {
  it('backs off exponentially and caps at 15s', () => {
    expect(radioReconnectDelayMs(0)).toBe(1000);
    expect(radioReconnectDelayMs(1)).toBe(2000);
    expect(radioReconnectDelayMs(2)).toBe(4000);
    expect(radioReconnectDelayMs(3)).toBe(8000);
    expect(radioReconnectDelayMs(4)).toBe(15000);
    expect(radioReconnectDelayMs(99)).toBe(15000);
  });

  it('clamps negative attempts to the first delay', () => {
    expect(radioReconnectDelayMs(-1)).toBe(1000);
  });
});
