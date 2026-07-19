import { radioNowPlayingStore } from '../radioNowPlayingStore';

beforeEach(() => {
  radioNowPlayingStore.getState().clear();
});

describe('radioNowPlayingStore', () => {
  it('stores the title with its owning track id', () => {
    radioNowPlayingStore.getState().setNowPlaying('internet-radio:ir-1', 'Artist - Song');
    expect(radioNowPlayingStore.getState().title).toBe('Artist - Song');
    expect(radioNowPlayingStore.getState().trackId).toBe('internet-radio:ir-1');
  });

  it('clear() wipes both fields', () => {
    radioNowPlayingStore.getState().setNowPlaying('internet-radio:ir-1', 'Artist - Song');
    radioNowPlayingStore.getState().clear();
    expect(radioNowPlayingStore.getState().title).toBeNull();
    expect(radioNowPlayingStore.getState().trackId).toBeNull();
  });
});
