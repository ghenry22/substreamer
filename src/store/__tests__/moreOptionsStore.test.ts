import { moreOptionsStore } from '../moreOptionsStore';

import { type AlbumID3, type Child } from '../../services/subsonicService';

const mockSong = { id: 's1', title: 'Song' } as Child;
const mockAlbum = { id: 'a1', name: 'Album' } as AlbumID3;

beforeEach(() => {
  moreOptionsStore.setState({ visible: false, entity: null, source: 'default' });
});

describe('moreOptionsStore', () => {
  it('show sets entity and defaults source to default', () => {
    moreOptionsStore.getState().show({ type: 'song', item: mockSong });
    const state = moreOptionsStore.getState();
    expect(state.visible).toBe(true);
    expect(state.entity).toEqual({ type: 'song', item: mockSong });
    expect(state.source).toBe('default');
  });

  it('show with explicit source sets source', () => {
    moreOptionsStore.getState().show({ type: 'album', item: mockAlbum }, 'player');
    expect(moreOptionsStore.getState().source).toBe('player');
  });

  it('show with playerpanel source sets source', () => {
    moreOptionsStore.getState().show({ type: 'song', item: mockSong }, 'playerpanel');
    expect(moreOptionsStore.getState().source).toBe('playerpanel');
  });

  it('show with playerexpanded source sets source', () => {
    moreOptionsStore.getState().show({ type: 'song', item: mockSong }, 'playerexpanded');
    expect(moreOptionsStore.getState().source).toBe('playerexpanded');
  });

  it('hide resets all fields including source', () => {
    moreOptionsStore.getState().show({ type: 'song', item: mockSong }, 'player');
    moreOptionsStore.getState().hide();
    const state = moreOptionsStore.getState();
    expect(state.visible).toBe(false);
    expect(state.entity).toBeNull();
    expect(state.source).toBe('default');
  });
});
