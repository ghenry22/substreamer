import { classifyAudio, getQualityColor, formatAudioDetails } from '../audioFormat';
import { type EffectiveFormat } from '../../types/audio';

const makeFmt = (overrides: Partial<EffectiveFormat>): EffectiveFormat => ({
  suffix: 'mp3',
  capturedAt: Date.now(),
  ...overrides,
});

describe('classifyAudio', () => {
  it('returns hires for lossless with ≥24-bit and ≥96kHz', () => {
    expect(classifyAudio(makeFmt({ suffix: 'flac', bitDepth: 24, samplingRate: 96000 }))).toBe('hires');
    expect(classifyAudio(makeFmt({ suffix: 'flac', bitDepth: 32, samplingRate: 192000 }))).toBe('hires');
  });

  it('returns lossless for standard-resolution lossless', () => {
    expect(classifyAudio(makeFmt({ suffix: 'flac', bitDepth: 16, samplingRate: 44100 }))).toBe('lossless');
    expect(classifyAudio(makeFmt({ suffix: 'flac' }))).toBe('lossless');
    expect(classifyAudio(makeFmt({ suffix: 'wav' }))).toBe('lossless');
    expect(classifyAudio(makeFmt({ suffix: 'alac' }))).toBe('lossless');
  });

  it('returns lossless when bitDepth is high but samplingRate is low', () => {
    expect(classifyAudio(makeFmt({ suffix: 'flac', bitDepth: 24, samplingRate: 44100 }))).toBe('lossless');
  });

  it('returns lossless when samplingRate is high but bitDepth is low', () => {
    expect(classifyAudio(makeFmt({ suffix: 'flac', bitDepth: 16, samplingRate: 96000 }))).toBe('lossless');
  });

  it('returns highLossy for lossy at ≥256 kbps', () => {
    expect(classifyAudio(makeFmt({ suffix: 'mp3', bitRate: 320 }))).toBe('highLossy');
    expect(classifyAudio(makeFmt({ suffix: 'opus', bitRate: 256 }))).toBe('highLossy');
    expect(classifyAudio(makeFmt({ suffix: 'aac', bitRate: 320 }))).toBe('highLossy');
  });

  it('returns standardLossy for lossy below 256 kbps', () => {
    expect(classifyAudio(makeFmt({ suffix: 'mp3', bitRate: 128 }))).toBe('standardLossy');
    expect(classifyAudio(makeFmt({ suffix: 'ogg', bitRate: 192 }))).toBe('standardLossy');
  });

  it('returns standardLossy for lossy with no bitRate', () => {
    expect(classifyAudio(makeFmt({ suffix: 'mp3' }))).toBe('standardLossy');
  });

  it('recognises raw preset as lossless', () => {
    expect(classifyAudio(makeFmt({ suffix: 'raw' }))).toBe('lossless');
  });

  it('recognises known lossless suffixes not in FORMAT_PRESETS', () => {
    expect(classifyAudio(makeFmt({ suffix: 'ape' }))).toBe('lossless');
    expect(classifyAudio(makeFmt({ suffix: 'wv' }))).toBe('lossless');
    expect(classifyAudio(makeFmt({ suffix: 'dsd' }))).toBe('lossless');
  });
});

describe('getQualityColor', () => {
  it('returns gold for hires', () => {
    expect(getQualityColor('hires')).toBe('#F5B400');
  });

  it('returns blue for lossless', () => {
    expect(getQualityColor('lossless')).toBe('#1DA1F2');
  });

  it('returns green for highLossy', () => {
    expect(getQualityColor('highLossy')).toBe('#10B981');
  });

  it('returns slate for standardLossy', () => {
    expect(getQualityColor('standardLossy')).toBe('#64748B');
  });
});

describe('formatAudioDetails', () => {
  it('formats lossless with bit depth and sample rate', () => {
    expect(formatAudioDetails(makeFmt({ suffix: 'flac', bitDepth: 24, samplingRate: 96000 })))
      .toBe('FLAC \u00B7 24-bit/96kHz');
  });

  it('formats lossless with fractional sample rate', () => {
    expect(formatAudioDetails(makeFmt({ suffix: 'flac', bitDepth: 16, samplingRate: 44100 })))
      .toBe('FLAC \u00B7 16-bit/44.1kHz');
  });

  it('formats lossy with bitrate', () => {
    expect(formatAudioDetails(makeFmt({ suffix: 'mp3', bitRate: 320 })))
      .toBe('MP3 \u00B7 320 kbps');
  });

  it('formats suffix only when no additional info', () => {
    expect(formatAudioDetails(makeFmt({ suffix: 'opus' }))).toBe('OPUS');
  });

  it('prefers bit depth/sample rate over bitrate for lossless', () => {
    expect(formatAudioDetails(makeFmt({
      suffix: 'flac',
      bitRate: 1411,
      bitDepth: 16,
      samplingRate: 44100,
    }))).toBe('FLAC \u00B7 16-bit/44.1kHz');
  });

  it('falls back to bitrate for lossless without bit depth', () => {
    expect(formatAudioDetails(makeFmt({ suffix: 'flac', bitRate: 1411 })))
      .toBe('FLAC \u00B7 1411 kbps');
  });

  it('handles sub-1kHz sample rate', () => {
    expect(formatAudioDetails(makeFmt({ suffix: 'wav', bitDepth: 16, samplingRate: 800 })))
      .toBe('WAV \u00B7 16-bit/800Hz');
  });
});
