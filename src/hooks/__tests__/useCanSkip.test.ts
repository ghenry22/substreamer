jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import { renderHook } from '@testing-library/react-native';
import { act } from 'react';

import { useCanSkip } from '../useCanSkip';
import { playerStore } from '../../store/playerStore';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';

beforeEach(() => {
  playerStore.setState({
    currentTrack: null,
    currentTrackIndex: null,
    playbackState: 'idle',
    queue: [],
    position: 0,
    duration: 0,
    bufferedPosition: 0,
    error: null,
    retrying: false,
    queueLoading: false,
  });
  playbackSettingsStore.setState({ repeatMode: 'off' } as any);
});

describe('useCanSkip', () => {
  it('returns both false when no track is loaded', () => {
    const { result } = renderHook(() => useCanSkip());
    expect(result.current).toEqual({ canSkipNext: false, canSkipPrevious: false });
  });

  it('returns both false when queue is empty', () => {
    playerStore.setState({ currentTrackIndex: 0, queue: [] });
    const { result } = renderHook(() => useCanSkip());
    expect(result.current).toEqual({ canSkipNext: false, canSkipPrevious: false });
  });

  it('returns canSkipPrevious true at first track with repeat off', () => {
    playerStore.setState({
      currentTrackIndex: 0,
      queue: [{ id: '1' }, { id: '2' }] as any[],
    });
    const { result } = renderHook(() => useCanSkip());
    expect(result.current.canSkipPrevious).toBe(true);
    expect(result.current.canSkipNext).toBe(true);
  });

  it('returns canSkipNext false at last track with repeat off', () => {
    playerStore.setState({
      currentTrackIndex: 1,
      queue: [{ id: '1' }, { id: '2' }] as any[],
    });
    const { result } = renderHook(() => useCanSkip());
    expect(result.current.canSkipNext).toBe(false);
    expect(result.current.canSkipPrevious).toBe(true);
  });

  it('returns both true in middle of queue with repeat off', () => {
    playerStore.setState({
      currentTrackIndex: 1,
      queue: [{ id: '1' }, { id: '2' }, { id: '3' }] as any[],
    });
    const { result } = renderHook(() => useCanSkip());
    expect(result.current).toEqual({ canSkipNext: true, canSkipPrevious: true });
  });

  it('returns both true with repeat all regardless of position', () => {
    playerStore.setState({
      currentTrackIndex: 0,
      queue: [{ id: '1' }, { id: '2' }] as any[],
    });
    playbackSettingsStore.setState({ repeatMode: 'all' } as any);
    const { result } = renderHook(() => useCanSkip());
    expect(result.current).toEqual({ canSkipNext: true, canSkipPrevious: true });
  });

  it('returns both true with repeat one', () => {
    playerStore.setState({
      currentTrackIndex: 1,
      queue: [{ id: '1' }, { id: '2' }] as any[],
    });
    playbackSettingsStore.setState({ repeatMode: 'one' } as any);
    const { result } = renderHook(() => useCanSkip());
    expect(result.current).toEqual({ canSkipNext: true, canSkipPrevious: true });
  });

  it('reacts to store changes', () => {
    const { result } = renderHook(() => useCanSkip());
    expect(result.current).toEqual({ canSkipNext: false, canSkipPrevious: false });

    act(() => {
      playerStore.setState({
        currentTrackIndex: 0,
        queue: [{ id: '1' }, { id: '2' }] as any[],
      });
    });

    expect(result.current.canSkipPrevious).toBe(true);
    expect(result.current.canSkipNext).toBe(true);
  });

  it('returns canSkipPrevious true for single-item queue', () => {
    playerStore.setState({
      currentTrackIndex: 0,
      queue: [{ id: '1' }] as any[],
    });
    const { result } = renderHook(() => useCanSkip());
    expect(result.current.canSkipPrevious).toBe(true);
    expect(result.current.canSkipNext).toBe(false);
  });
});
