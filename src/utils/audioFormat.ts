/**
 * Audio format classification and presentation helpers.
 *
 * Maps EffectiveFormat data into UI-friendly quality tiers, colors,
 * and display strings for the track info panel.
 */

import { type EffectiveFormat } from '../types/audio';
import { FORMAT_PRESETS } from '../store/playbackSettingsStore';

/* ------------------------------------------------------------------ */
/*  Quality tiers                                                      */
/* ------------------------------------------------------------------ */

export type AudioQualityTier = 'hires' | 'lossless' | 'highLossy' | 'standardLossy';

/** Suffixes treated as lossless (beyond the FORMAT_PRESETS list). */
const KNOWN_LOSSLESS_SUFFIXES = new Set([
  'flac', 'alac', 'wav', 'aiff', 'aif', 'dsd', 'dsf', 'dff', 'ape', 'wv',
]);

/**
 * Determine whether a suffix represents a lossless codec.
 * Checks FORMAT_PRESETS first, then falls back to a known-lossless set.
 */
function isLosslessSuffix(suffix: string): boolean {
  const lower = suffix.toLowerCase();
  const preset = FORMAT_PRESETS.find((p) => p.value === lower);
  if (preset) return preset.lossless;
  return KNOWN_LOSSLESS_SUFFIXES.has(lower);
}

/**
 * Classify an EffectiveFormat into a quality tier.
 *
 * - **hires**: lossless AND bitDepth >= 24 AND samplingRate >= 96000
 *   (JAS Hi-Res Audio standard)
 * - **lossless**: lossless codec at standard resolution
 * - **highLossy**: lossy codec at >= 256 kbps
 * - **standardLossy**: everything else
 */
export function classifyAudio(fmt: EffectiveFormat): AudioQualityTier {
  const lossless = isLosslessSuffix(fmt.suffix);

  if (lossless) {
    const hiRes =
      fmt.bitDepth != null &&
      fmt.bitDepth >= 24 &&
      fmt.samplingRate != null &&
      fmt.samplingRate >= 96000;
    return hiRes ? 'hires' : 'lossless';
  }

  if (fmt.bitRate != null && fmt.bitRate >= 256) {
    return 'highLossy';
  }

  return 'standardLossy';
}

/* ------------------------------------------------------------------ */
/*  Quality colors                                                     */
/* ------------------------------------------------------------------ */

const QUALITY_COLORS: Record<AudioQualityTier, string> = {
  hires: '#F5B400',        // gold
  lossless: '#1DA1F2',     // blue
  highLossy: '#10B981',    // green
  standardLossy: '#64748B', // slate
};

/** Get the theme color for a quality tier. */
export function getQualityColor(tier: AudioQualityTier): string {
  return QUALITY_COLORS[tier];
}

/* ------------------------------------------------------------------ */
/*  Display formatting                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build a compact detail string for audio format.
 * Examples: "FLAC · 24-bit/96kHz", "MP3 · 320 kbps", "OPUS · 128 kbps"
 */
export function formatAudioDetails(fmt: EffectiveFormat): string {
  const parts: string[] = [fmt.suffix.toUpperCase()];

  const lossless = isLosslessSuffix(fmt.suffix);

  if (lossless && fmt.bitDepth != null && fmt.samplingRate != null) {
    const rateKHz = fmt.samplingRate >= 1000
      ? `${(fmt.samplingRate / 1000).toFixed(fmt.samplingRate % 1000 === 0 ? 0 : 1)}kHz`
      : `${fmt.samplingRate}Hz`;
    parts.push(`${fmt.bitDepth}-bit/${rateKHz}`);
  } else if (fmt.bitRate != null) {
    parts.push(`${fmt.bitRate} kbps`);
  }

  return parts.join(' \u00B7 ');
}
