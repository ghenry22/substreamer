import { useMemo } from 'react';

import { type LyricsLine } from '../services/subsonicService';

const MIN_DURATION_SEC = 60;
const MIN_LINES = 4;
const LEAD_IN_RATIO = 0.15;
const LEAD_IN_CAP_SEC = 8;
const LEAD_OUT_RATIO = 0.2;
const LEAD_OUT_CAP_SEC = 12;

/**
 * Synthesize evenly-spaced line timings for unsynced lyrics when the track is
 * long enough and has enough lines to make a passable karaoke-style display.
 * Returns `null` when fake timing should not be applied — caller falls back to
 * the plain unsynced view in that case.
 */
export function useFakeLineTimings(
  lines: LyricsLine[],
  durationSec: number | null | undefined,
): LyricsLine[] | null {
  return useMemo(() => {
    if (!durationSec || durationSec < MIN_DURATION_SEC) return null;
    if (lines.length < MIN_LINES) return null;

    const leadInSec = Math.min(LEAD_IN_CAP_SEC, durationSec * LEAD_IN_RATIO);
    const leadOutSec = Math.min(LEAD_OUT_CAP_SEC, durationSec * LEAD_OUT_RATIO);
    const span = Math.max(0, durationSec - leadInSec - leadOutSec);
    const step = span / lines.length;

    return lines.map((line, i) => ({
      startMs: Math.round((leadInSec + i * step) * 1000),
      text: line.text,
    }));
  }, [lines, durationSec]);
}
