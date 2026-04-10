import { createShareStore } from '../createShareStore';

beforeEach(() => {
  createShareStore.setState({
    visible: false,
    shareType: 'album',
    itemId: null,
    songIds: [],
    itemName: '',
    artistName: null,
    coverArtId: null,
  });
});

describe('createShareStore', () => {
  it('showAlbum sets album share state', () => {
    createShareStore.getState().showAlbum('a1', 'My Album');
    const state = createShareStore.getState();
    expect(state.visible).toBe(true);
    expect(state.shareType).toBe('album');
    expect(state.itemId).toBe('a1');
    expect(state.itemName).toBe('My Album');
    expect(state.artistName).toBeNull();
    expect(state.songIds).toEqual([]);
    expect(state.coverArtId).toBeNull();
  });

  it('showAlbum passes artistName and coverArtId', () => {
    createShareStore.getState().showAlbum('a1', 'My Album', 'The Artist', 'cover-1');
    const state = createShareStore.getState();
    expect(state.artistName).toBe('The Artist');
    expect(state.coverArtId).toBe('cover-1');
  });

  it('showPlaylist sets playlist share state', () => {
    createShareStore.getState().showPlaylist('p1', 'My Playlist');
    const state = createShareStore.getState();
    expect(state.visible).toBe(true);
    expect(state.shareType).toBe('playlist');
    expect(state.itemId).toBe('p1');
    expect(state.itemName).toBe('My Playlist');
    expect(state.artistName).toBeNull();
    expect(state.coverArtId).toBeNull();
  });

  it('showPlaylist passes coverArtId', () => {
    createShareStore.getState().showPlaylist('p1', 'My Playlist', 'cover-2');
    expect(createShareStore.getState().coverArtId).toBe('cover-2');
  });

  it('showQueue sets queue share state with no coverArtId', () => {
    createShareStore.getState().showQueue(['s1', 's2']);
    const state = createShareStore.getState();
    expect(state.visible).toBe(true);
    expect(state.shareType).toBe('queue');
    expect(state.itemId).toBeNull();
    expect(state.songIds).toEqual(['s1', 's2']);
    expect(state.itemName).toBe('Current Queue');
    expect(state.artistName).toBeNull();
    expect(state.coverArtId).toBeNull();
  });

  it('hide resets state including artistName and coverArtId', () => {
    createShareStore.getState().showAlbum('a1', 'My Album', 'The Artist', 'cover-1');
    createShareStore.getState().hide();
    const state = createShareStore.getState();
    expect(state.visible).toBe(false);
    expect(state.itemId).toBeNull();
    expect(state.songIds).toEqual([]);
    expect(state.itemName).toBe('');
    expect(state.artistName).toBeNull();
    expect(state.coverArtId).toBeNull();
  });
});
