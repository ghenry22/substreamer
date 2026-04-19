jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');

import { resolveEffectiveFormat, getEffectiveFormat } from '../effectiveFormat';
import { musicCacheStore } from '../../store/musicCacheStore';
import { playerStore } from '../../store/playerStore';
import { type EffectiveFormat } from '../../types/audio';
import { type Child } from '../../services/subsonicService';

beforeEach(() => {
  musicCacheStore.setState({ cachedSongs: {} });
  playerStore.setState({ queueFormats: {} });
});

/* ------------------------------------------------------------------ */
/*  resolveEffectiveFormat                                              */
/* ------------------------------------------------------------------ */

describe('resolveEffectiveFormat', () => {
  it('passes through source fields for raw format', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: 'flac',
      sourceBitRate: 950,
      sourceBitDepth: 24,
      sourceSamplingRate: 96000,
      formatSetting: 'raw',
      bitRateSetting: null,
    });
    expect(result.suffix).toBe('flac');
    expect(result.bitRate).toBe(950);
    expect(result.bitDepth).toBe(24);
    expect(result.samplingRate).toBe(96000);
    expect(result.capturedAt).toBeGreaterThan(0);
  });

  it('returns unknown suffix for raw with no source suffix', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: null,
      sourceBitRate: null,
      formatSetting: 'raw',
      bitRateSetting: null,
    });
    expect(result.suffix).toBe('unknown');
    expect(result.bitRate).toBeUndefined();
  });

  it('lowercases suffix for raw', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: 'FLAC',
      sourceBitRate: 800,
      formatSetting: 'raw',
      bitRateSetting: null,
    });
    expect(result.suffix).toBe('flac');
  });

  it('uses format setting suffix for transcoded', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: 'flac',
      sourceBitRate: 950,
      formatSetting: 'mp3',
      bitRateSetting: 320,
    });
    expect(result.suffix).toBe('mp3');
    expect(result.bitRate).toBe(320);
    expect(result.bitDepth).toBeUndefined();
    expect(result.samplingRate).toBeUndefined();
  });

  it('caps bitrate to source when source is lower', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: 'mp3',
      sourceBitRate: 192,
      formatSetting: 'mp3',
      bitRateSetting: 320,
    });
    expect(result.bitRate).toBe(192);
  });

  it('uses source bitrate when setting is unlimited (null)', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: 'flac',
      sourceBitRate: 950,
      formatSetting: 'opus',
      bitRateSetting: null,
    });
    expect(result.suffix).toBe('opus');
    expect(result.bitRate).toBe(950);
  });

  it('returns undefined bitrate when both setting and source are null', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: 'flac',
      sourceBitRate: null,
      formatSetting: 'mp3',
      bitRateSetting: null,
    });
    expect(result.bitRate).toBeUndefined();
  });

  it('lowercases transcoded format setting', () => {
    const result = resolveEffectiveFormat({
      sourceSuffix: 'flac',
      sourceBitRate: 950,
      formatSetting: 'MP3',
      bitRateSetting: 128,
    });
    expect(result.suffix).toBe('mp3');
  });
});

/* ------------------------------------------------------------------ */
/*  getEffectiveFormat — lookup priority                                */
/* ------------------------------------------------------------------ */

describe('getEffectiveFormat', () => {
  const track = { id: 't1', suffix: 'flac', bitRate: 900 } as Child;

  it('prefers downloaded format over queue and source', () => {
    musicCacheStore.setState({
      cachedSongs: {
        t1: {
          id: 't1',
          title: 'T',
          albumId: 'a1',
          bytes: 1,
          duration: 1,
          suffix: 'mp3',
          bitRate: 192,
          formatCapturedAt: 1000,
          downloadedAt: 1000,
        } as any,
      },
    });
    playerStore.setState({
      queueFormats: { t1: { suffix: 'opus', bitRate: 128, capturedAt: 2000 } },
    });

    const result = getEffectiveFormat(track);
    expect(result).not.toBeNull();
    expect(result!.suffix).toBe('mp3');
    expect(result!.bitRate).toBe(192);
    expect(result!.capturedAt).toBe(1000);
  });

  it('falls back to queue format when no download entry', () => {
    const queued: EffectiveFormat = {
      suffix: 'opus', bitRate: 128, capturedAt: 2000,
    };
    playerStore.setState({ queueFormats: { t1: queued } });

    const result = getEffectiveFormat(track);
    expect(result).toBe(queued);
  });

  it('falls back to source Child fields when no download or queue entry', () => {
    const result = getEffectiveFormat(track);
    expect(result).not.toBeNull();
    expect(result!.suffix).toBe('flac');
    expect(result!.bitRate).toBe(900);
    expect(result!.capturedAt).toBe(0);
  });

  it('returns null when track has no suffix or bitRate', () => {
    const emptyTrack = { id: 't2' } as Child;
    const result = getEffectiveFormat(emptyTrack);
    expect(result).toBeNull();
  });

  it('returns source format with only suffix (no bitRate)', () => {
    const suffixOnly = { id: 't3', suffix: 'wav' } as Child;
    const result = getEffectiveFormat(suffixOnly);
    expect(result).not.toBeNull();
    expect(result!.suffix).toBe('wav');
    expect(result!.bitRate).toBeUndefined();
  });
});
