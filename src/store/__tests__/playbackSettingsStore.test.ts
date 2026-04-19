jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { FORMAT_PRESETS, playbackSettingsStore } from '../playbackSettingsStore';

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
    showSleepTimerButton: false,
    skipBackwardInterval: 15,
    skipForwardInterval: 30,
    remoteControlMode: 'skip-track',
    artistPlayMode: 'topSongs',
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

  it('setShowSleepTimerButton updates flag', () => {
    playbackSettingsStore.getState().setShowSleepTimerButton(true);
    expect(playbackSettingsStore.getState().showSleepTimerButton).toBe(true);
  });

  it('setArtistPlayMode updates artist play mode', () => {
    playbackSettingsStore.getState().setArtistPlayMode('allSongs');
    expect(playbackSettingsStore.getState().artistPlayMode).toBe('allSongs');
  });

  it('setArtistPlayMode toggles back to topSongs', () => {
    playbackSettingsStore.getState().setArtistPlayMode('allSongs');
    playbackSettingsStore.getState().setArtistPlayMode('topSongs');
    expect(playbackSettingsStore.getState().artistPlayMode).toBe('topSongs');
  });

  it('defaults for skip interval fields', () => {
    const state = playbackSettingsStore.getState();
    expect(state.showSkipIntervalButtons).toBe(false);
    expect(state.showSleepTimerButton).toBe(false);
    expect(state.skipBackwardInterval).toBe(15);
    expect(state.skipForwardInterval).toBe(30);
    expect(state.remoteControlMode).toBe('skip-track');
    expect(state.artistPlayMode).toBe('topSongs');
  });

  describe('format normalization', () => {
    it('lowercases and trims streamFormat input', () => {
      playbackSettingsStore.getState().setStreamFormat('  OPUS_128_CAR  ');
      expect(playbackSettingsStore.getState().streamFormat).toBe('opus_128_car');
    });

    it('lowercases and trims downloadFormat input', () => {
      playbackSettingsStore.getState().setDownloadFormat('  FLAC ');
      expect(playbackSettingsStore.getState().downloadFormat).toBe('flac');
    });

    it("preserves 'raw' as the canonical sentinel", () => {
      playbackSettingsStore.getState().setStreamFormat('raw');
      expect(playbackSettingsStore.getState().streamFormat).toBe('raw');
    });

    it('accepts arbitrary custom format strings', () => {
      playbackSettingsStore.getState().setStreamFormat('opus_192_rg');
      expect(playbackSettingsStore.getState().streamFormat).toBe('opus_192_rg');
    });
  });

  describe('FORMAT_PRESETS', () => {
    it('includes raw and flac as lossless with no high bitrate', () => {
      const raw = FORMAT_PRESETS.find((p) => p.value === 'raw');
      const flac = FORMAT_PRESETS.find((p) => p.value === 'flac');
      expect(raw?.lossless).toBe(true);
      expect(raw?.highBitrate).toBeNull();
      expect(flac?.lossless).toBe(true);
      expect(flac?.highBitrate).toBeNull();
    });

    it('marks all non-lossless presets with a numeric high bitrate', () => {
      const lossy = FORMAT_PRESETS.filter((p) => !p.lossless);
      expect(lossy.length).toBeGreaterThan(0);
      for (const preset of lossy) {
        expect(typeof preset.highBitrate).toBe('number');
      }
    });

    it('uses 192 high bitrate for opus_car (loudness-compressed profile)', () => {
      const opusCar = FORMAT_PRESETS.find((p) => p.value === 'opus_car');
      expect(opusCar?.highBitrate).toBe(192);
    });

    it('uses 320 high bitrate for the standard lossy presets', () => {
      const standardLossy = ['mp3', 'mp3_rg', 'mp3_car', 'aac', 'm4a', 'opus', 'opus_rg', 'ogg'];
      for (const value of standardLossy) {
        const preset = FORMAT_PRESETS.find((p) => p.value === value);
        expect(preset?.highBitrate).toBe(320);
      }
    });

    it('uses unique values across all presets', () => {
      const values = FORMAT_PRESETS.map((p) => p.value);
      expect(new Set(values).size).toBe(values.length);
    });

    it('groups variants under their base codec', () => {
      const groupOf = (value: string) => FORMAT_PRESETS.find((p) => p.value === value)?.group;
      expect(groupOf('mp3')).toBe('mp3');
      expect(groupOf('mp3_rg')).toBe('mp3');
      expect(groupOf('mp3_car')).toBe('mp3');
      expect(groupOf('opus')).toBe('opus');
      expect(groupOf('opus_rg')).toBe('opus');
      expect(groupOf('opus_car')).toBe('opus');
      expect(groupOf('aac')).toBe('aac');
      expect(groupOf('m4a')).toBe('aac');
      expect(groupOf('ogg')).toBe('ogg');
      expect(groupOf('flac')).toBe('flac');
      expect(groupOf('raw')).toBe('raw');
    });

    it('keeps all presets within a group contiguous in the array', () => {
      const seenGroups = new Set<string>();
      let currentGroup: string | null = null;
      for (const preset of FORMAT_PRESETS) {
        if (preset.group !== currentGroup) {
          expect(seenGroups.has(preset.group)).toBe(false);
          seenGroups.add(preset.group);
          currentGroup = preset.group;
        }
      }
    });
  });
});
