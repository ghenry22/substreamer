import { playerStore } from '../playerStore';

import { type Child } from '../../services/subsonicService';

const mockTrack = { id: 't1', title: 'Track 1', duration: 300 } as Child;

beforeEach(() => {
  playerStore.setState({
    currentTrack: null,
    currentTrackIndex: null,
    playbackState: 'idle',
    queue: [],
    queueOrigins: [],
    autoplayLoading: false,
    position: 0,
    duration: 0,
    bufferedPosition: 0,
    error: null,
    retrying: false,
    queueLoading: false,
    queueFormats: {},
  });
});

describe('playerStore', () => {
  it('setCurrentTrack sets track and index', () => {
    playerStore.getState().setCurrentTrack(mockTrack, 2);
    const state = playerStore.getState();
    expect(state.currentTrack).toBe(mockTrack);
    expect(state.currentTrackIndex).toBe(2);
  });

  it('setCurrentTrack defaults index to null', () => {
    playerStore.getState().setCurrentTrack(mockTrack);
    expect(playerStore.getState().currentTrackIndex).toBeNull();
  });

  it('setCurrentTrack to null clears track', () => {
    playerStore.getState().setCurrentTrack(mockTrack, 0);
    playerStore.getState().setCurrentTrack(null);
    expect(playerStore.getState().currentTrack).toBeNull();
    expect(playerStore.getState().currentTrackIndex).toBeNull();
  });

  it('setPlaybackState updates state', () => {
    playerStore.getState().setPlaybackState('playing');
    expect(playerStore.getState().playbackState).toBe('playing');
  });

  it('setQueue updates queue', () => {
    const queue = [mockTrack];
    playerStore.getState().setQueue(queue);
    expect(playerStore.getState().queue).toBe(queue);
    expect(playerStore.getState().queueOrigins).toEqual(['manual']);
  });

  it('setQueue keeps aligned origins and rejects a mismatched list', () => {
    playerStore.getState().setQueue([mockTrack], ['autoplay']);
    expect(playerStore.getState().queueOrigins).toEqual(['autoplay']);

    playerStore.getState().setQueue([mockTrack], []);
    expect(playerStore.getState().queueOrigins).toEqual(['manual']);
  });

  it('setAutoplayLoading updates the loading flag', () => {
    playerStore.getState().setAutoplayLoading(true);
    expect(playerStore.getState().autoplayLoading).toBe(true);
  });

  describe('setProgress', () => {
    it('uses provided duration when > 0', () => {
      playerStore.getState().setProgress(10, 200, 50);
      const state = playerStore.getState();
      expect(state.position).toBe(10);
      expect(state.duration).toBe(200);
      expect(state.bufferedPosition).toBe(50);
    });

    it('falls back to currentTrack.duration when duration is 0', () => {
      playerStore.setState({ currentTrack: mockTrack });
      playerStore.getState().setProgress(10, 0, 50);
      expect(playerStore.getState().duration).toBe(300);
    });

    it('falls back to 0 when duration is 0 and no currentTrack', () => {
      playerStore.getState().setProgress(10, 0, 50);
      expect(playerStore.getState().duration).toBe(0);
    });
  });

  it('setError updates error', () => {
    playerStore.getState().setError('Playback failed');
    expect(playerStore.getState().error).toBe('Playback failed');
  });

  it('setError to null clears error', () => {
    playerStore.setState({ error: 'old' });
    playerStore.getState().setError(null);
    expect(playerStore.getState().error).toBeNull();
  });

  it('setRetrying updates retrying', () => {
    playerStore.getState().setRetrying(true);
    expect(playerStore.getState().retrying).toBe(true);
  });

  it('setQueueLoading updates queueLoading', () => {
    playerStore.getState().setQueueLoading(true);
    expect(playerStore.getState().queueLoading).toBe(true);
  });

  describe('queueFormats', () => {
    const fmt = { suffix: 'flac', bitRate: 1411, capturedAt: 1000 };
    const fmt2 = { suffix: 'mp3', bitRate: 320, capturedAt: 2000 };

    it('setQueueFormats replaces entire map', () => {
      playerStore.getState().setQueueFormats({ s1: fmt, s2: fmt2 });
      expect(playerStore.getState().queueFormats).toEqual({ s1: fmt, s2: fmt2 });
    });

    it('setQueueFormats overwrites previous map', () => {
      playerStore.getState().setQueueFormats({ s1: fmt });
      playerStore.getState().setQueueFormats({ s3: fmt2 });
      expect(playerStore.getState().queueFormats).toEqual({ s3: fmt2 });
    });

    it('addQueueFormat adds a single entry', () => {
      playerStore.getState().setQueueFormats({ s1: fmt });
      playerStore.getState().addQueueFormat('s2', fmt2);
      expect(playerStore.getState().queueFormats).toEqual({ s1: fmt, s2: fmt2 });
    });

    it('addQueueFormat overwrites existing entry', () => {
      playerStore.getState().setQueueFormats({ s1: fmt });
      playerStore.getState().addQueueFormat('s1', fmt2);
      expect(playerStore.getState().queueFormats).toEqual({ s1: fmt2 });
    });

    it('clearQueueFormats empties the map', () => {
      playerStore.getState().setQueueFormats({ s1: fmt, s2: fmt2 });
      playerStore.getState().clearQueueFormats();
      expect(playerStore.getState().queueFormats).toEqual({});
    });
  });
});
