/**
 * Effective format resolution and lookup.
 *
 * Resolves what audio format is actually being delivered to the user
 * (post-transcode) based on playback settings and source file metadata.
 * Also provides a single lookup that checks downloaded format first,
 * then the player queue, then falls back to source Child fields.
 */

import { type EffectiveFormat, type MaxBitRate, type StreamFormat } from '../types/audio';
import { musicCacheStore } from '../store/musicCacheStore';
import { playerStore } from '../store/playerStore';
import { type Child } from '../services/subsonicService';

/* ------------------------------------------------------------------ */
/*  Resolution                                                         */
/* ------------------------------------------------------------------ */

export interface FormatResolutionInput {
  /** Source file suffix from the Subsonic Child (e.g. "flac", "mp3"). */
  sourceSuffix?: string | null;
  /** Source file bitrate in kbps from the Subsonic Child. */
  sourceBitRate?: number | null;
  /** Source bit depth (OpenSubsonic only). */
  sourceBitDepth?: number | null;
  /** Source sample rate in Hz (OpenSubsonic only). */
  sourceSamplingRate?: number | null;
  /** The format setting at the moment of capture ('raw', 'mp3', etc.). */
  formatSetting: StreamFormat;
  /** The max bitrate setting at the moment of capture. */
  bitRateSetting: MaxBitRate;
}

/**
 * Resolve the format that will actually be delivered to the player.
 * Pure function — no store reads, easy to unit-test.
 */
export function resolveEffectiveFormat(input: FormatResolutionInput): EffectiveFormat {
  const now = Date.now();

  if (input.formatSetting === 'raw') {
    // Raw / original — no transcoding. What the server has is what we get.
    return {
      suffix: input.sourceSuffix?.toLowerCase() ?? 'unknown',
      bitRate: input.sourceBitRate ?? undefined,
      bitDepth: input.sourceBitDepth ?? undefined,
      samplingRate: input.sourceSamplingRate ?? undefined,
      capturedAt: now,
    };
  }

  // Transcoded — the server re-encodes to the requested format.
  // Bit depth and sample rate are not meaningful for lossy transcodes.
  const effectiveBitRate = resolveEffectiveBitRate(
    input.bitRateSetting,
    input.sourceBitRate ?? undefined,
  );

  return {
    suffix: input.formatSetting.toLowerCase(),
    bitRate: effectiveBitRate,
    capturedAt: now,
  };
}

/**
 * Determine the effective bitrate for a transcoded stream.
 * - null (no limit) → use source bitrate if known, otherwise undefined
 * - explicit limit → min of limit and source (server won't upscale)
 */
function resolveEffectiveBitRate(
  setting: MaxBitRate,
  sourceBitRate?: number,
): number | undefined {
  if (setting == null) {
    // No limit — server uses its default high quality or the source rate.
    return sourceBitRate;
  }
  if (sourceBitRate != null && sourceBitRate < setting) {
    return sourceBitRate;
  }
  return setting;
}

/* ------------------------------------------------------------------ */
/*  Lookup                                                             */
/* ------------------------------------------------------------------ */

/**
 * Get the effective format for a track, checking:
 *   1. Downloaded copy (authoritative — RNTP plays the local file)
 *   2. Player queue stamp (current streaming session)
 *   3. Source Child fields (fallback — no transcode info available)
 *
 * Returns null only when absolutely nothing is known.
 */
export function getEffectiveFormat(track: Child): EffectiveFormat | null {
  // 1. Downloaded copy is authoritative. Format info lives inline on the
  //    cached song row since v2 (previously in a separate downloadedFormats map).
  const downloadedSong = musicCacheStore.getState().cachedSongs[track.id];
  if (downloadedSong) {
    return {
      suffix: downloadedSong.suffix.toLowerCase(),
      bitRate: downloadedSong.bitRate,
      bitDepth: downloadedSong.bitDepth,
      samplingRate: downloadedSong.samplingRate,
      capturedAt: downloadedSong.formatCapturedAt,
    };
  }

  // 2. Live streaming queue stamp.
  const queued = playerStore.getState().queueFormats[track.id];
  if (queued) return queued;

  // 3. Source Child fields — no transcode info, but suffix/bitRate may exist.
  if (track.suffix || track.bitRate) {
    return {
      suffix: track.suffix?.toLowerCase() ?? 'unknown',
      bitRate: track.bitRate ?? undefined,
      bitDepth: track.bitDepth ?? undefined,
      samplingRate: track.samplingRate ?? undefined,
      capturedAt: 0, // sentinel: not a captured stamp, just source data
    };
  }

  return null;
}
