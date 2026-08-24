import type { QueueTrackOrigin } from '../types/queue';

/** Whether `index` is the first upcoming autoplay-owned row. */
export function isAutoplaySectionStart(
  origins: readonly QueueTrackOrigin[],
  currentTrackIndex: number | null,
  index: number,
): boolean {
  const firstUpcomingIndex = (currentTrackIndex ?? -1) + 1;
  return index >= firstUpcomingIndex &&
    origins[index] === 'autoplay' &&
    (index === firstUpcomingIndex || origins[index - 1] !== 'autoplay');
}
