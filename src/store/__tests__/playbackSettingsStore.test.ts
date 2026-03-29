jest.mock('../sqliteStorage', () => require('../__mocks__/sqliteStorage'));

import { playbackSettingsStore } from '../playbackSettingsStore';

beforeEach(() => {
  playbackSettingsStore.setState({
    maxBitRate: null,
    streamFormat: 'raw',
    estimateContentLength: false,
    repeatMode: 'off',
    playbackRate: 1,
    downloadMaxBitRate: 320,
    downloadFormat: 'mp3',
    showSkipIntervalButtons: false,
    skipBackwardInterval: 15,
    skipForwardInterval: 30,
    remoteControlMode: 'skip-track',
  });
});

describe('playbackSettingsStore', () => {
  it('setMaxBitRate updates bitrate', () => {
    playbackSettingsStore.getState().setMaxBitRate(320);
    expect(playbackSettingsStore.getState().maxBitRate).toBe(320);
  });

  it('setMaxBitRate to null removes limit', () => {
    playbackSettingsStore.getState().setMaxBitRate(320);
    playbackSettingsStore.getState().setMaxBitRate(null);
    expect(playbackSettingsStore.getState().maxBitRate).toBeNull();
  });

  it('setStreamFormat updates format', () => {
    playbackSettingsStore.getState().setStreamFormat('mp3');
    expect(playbackSettingsStore.getState().streamFormat).toBe('mp3');
  });

  it('setEstimateContentLength updates flag', () => {
    playbackSettingsStore.getState().setEstimateContentLength(true);
    expect(playbackSettingsStore.getState().estimateContentLength).toBe(true);
  });

  it('setRepeatMode updates repeat mode', () => {
    playbackSettingsStore.getState().setRepeatMode('all');
    expect(playbackSettingsStore.getState().repeatMode).toBe('all');
  });

  it('setPlaybackRate updates rate', () => {
    playbackSettingsStore.getState().setPlaybackRate(1.5);
    expect(playbackSettingsStore.getState().playbackRate).toBe(1.5);
  });

  it('setDownloadMaxBitRate updates download bitrate', () => {
    playbackSettingsStore.getState().setDownloadMaxBitRate(128);
    expect(playbackSettingsStore.getState().downloadMaxBitRate).toBe(128);
  });

  it('setDownloadFormat updates download format', () => {
    playbackSettingsStore.getState().setDownloadFormat('raw');
    expect(playbackSettingsStore.getState().downloadFormat).toBe('raw');
  });

  it('setShowSkipIntervalButtons updates flag', () => {
    playbackSettingsStore.getState().setShowSkipIntervalButtons(true);
    expect(playbackSettingsStore.getState().showSkipIntervalButtons).toBe(true);
  });

  it('setSkipBackwardInterval updates backward interval', () => {
    playbackSettingsStore.getState().setSkipBackwardInterval(30);
    expect(playbackSettingsStore.getState().skipBackwardInterval).toBe(30);
  });

  it('setSkipForwardInterval updates forward interval', () => {
    playbackSettingsStore.getState().setSkipForwardInterval(60);
    expect(playbackSettingsStore.getState().skipForwardInterval).toBe(60);
  });

  it('setRemoteControlMode updates remote control mode', () => {
    playbackSettingsStore.getState().setRemoteControlMode('skip-interval');
    expect(playbackSettingsStore.getState().remoteControlMode).toBe('skip-interval');
  });

  it('defaults for skip interval fields', () => {
    const state = playbackSettingsStore.getState();
    expect(state.showSkipIntervalButtons).toBe(false);
    expect(state.skipBackwardInterval).toBe(15);
    expect(state.skipForwardInterval).toBe(30);
    expect(state.remoteControlMode).toBe('skip-track');
  });
});
