/**
 * Shared formatting utilities used across the app.
 */

/**
 * Format a duration in seconds to a compact human-readable string.
 * Examples: "46m", "1h30m", "2h".
 */
export function formatCompactDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

/**
 * Format a duration in seconds as m:ss for individual track display.
 * Examples: "3:42", "0:30", "12:05".
 */
export function formatTrackDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Strip HTML tags from a string.
 * Useful for cleaning biographies from Last.fm or other sources.
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Format a byte count into a compact human-readable string.
 * Examples: "0 B", "4.2 KB", "128 MB", "1 GB".
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
