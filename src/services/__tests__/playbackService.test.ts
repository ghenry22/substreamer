const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockStop = jest.fn();
const mockSkipToNext = jest.fn();
const mockSkipToPrevious = jest.fn();
const mockSeekTo = jest.fn();

const eventHandlers: Record<string, Function> = {};

const mockGetProgress = jest.fn();

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn((event: string, handler: Function) => {
      eventHandlers[event] = handler;
    }),
    play: mockPlay,
    pause: mockPause,
    stop: mockStop,
    skipToNext: mockSkipToNext,
    skipToPrevious: mockSkipToPrevious,
    seekTo: mockSeekTo,
    getProgress: mockGetProgress,
  },
  Event: {
    RemotePlay: 'remote-play',
    RemotePause: 'remote-pause',
    RemoteStop: 'remote-stop',
    RemoteNext: 'remote-next',
    RemotePrevious: 'remote-previous',
    RemoteSeek: 'remote-seek',
    RemoteJumpForward: 'remote-jump-forward',
    RemoteJumpBackward: 'remote-jump-backward',
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  Object.keys(eventHandlers).forEach((k) => delete eventHandlers[k]);
  const service = require('../playbackService');
  await service();
});

describe('playbackService', () => {
  it('registers handlers for all remote events', () => {
    expect(eventHandlers['remote-play']).toBeDefined();
    expect(eventHandlers['remote-pause']).toBeDefined();
    expect(eventHandlers['remote-stop']).toBeDefined();
    expect(eventHandlers['remote-next']).toBeDefined();
    expect(eventHandlers['remote-previous']).toBeDefined();
    expect(eventHandlers['remote-seek']).toBeDefined();
    expect(eventHandlers['remote-jump-forward']).toBeDefined();
    expect(eventHandlers['remote-jump-backward']).toBeDefined();
  });

  it('RemotePlay calls TrackPlayer.play', () => {
    eventHandlers['remote-play']();
    expect(mockPlay).toHaveBeenCalled();
  });

  it('RemotePause calls TrackPlayer.pause', () => {
    eventHandlers['remote-pause']();
    expect(mockPause).toHaveBeenCalled();
  });

  it('RemoteStop calls TrackPlayer.stop', () => {
    eventHandlers['remote-stop']();
    expect(mockStop).toHaveBeenCalled();
  });

  it('RemoteNext calls TrackPlayer.skipToNext', () => {
    eventHandlers['remote-next']();
    expect(mockSkipToNext).toHaveBeenCalled();
  });

  it('RemotePrevious calls TrackPlayer.skipToPrevious', () => {
    eventHandlers['remote-previous']();
    expect(mockSkipToPrevious).toHaveBeenCalled();
  });

  it('RemoteSeek calls TrackPlayer.seekTo with position', () => {
    eventHandlers['remote-seek']({ position: 42 });
    expect(mockSeekTo).toHaveBeenCalledWith(42);
  });

  it('RemoteJumpForward seeks forward by interval', async () => {
    mockGetProgress.mockResolvedValue({ position: 30, duration: 200, buffered: 200 });
    await eventHandlers['remote-jump-forward']({ interval: 15 });
    expect(mockSeekTo).toHaveBeenCalledWith(45);
  });

  it('RemoteJumpBackward seeks backward by interval', async () => {
    mockGetProgress.mockResolvedValue({ position: 30, duration: 200, buffered: 200 });
    await eventHandlers['remote-jump-backward']({ interval: 15 });
    expect(mockSeekTo).toHaveBeenCalledWith(15);
  });

  it('RemoteJumpBackward clamps to 0', async () => {
    mockGetProgress.mockResolvedValue({ position: 5, duration: 200, buffered: 200 });
    await eventHandlers['remote-jump-backward']({ interval: 30 });
    expect(mockSeekTo).toHaveBeenCalledWith(0);
  });
});
