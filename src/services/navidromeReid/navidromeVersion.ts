/**
 * Does this server need the Navidrome 0.64 id re-key?
 *
 * Navidrome's `consts.Version` (`reference/navidrome/consts/version.go:16-26`) is
 * `"<tag> (<sha>)"` with the leading `v` stripped, or the literal `dev` when built without
 * build flags. A non-release build appends to the tag (`0.64.2-SNAPSHOT (abc1234)`).
 *
 * The existing `compareVersions` in `serverCapabilityService` cannot read that — it does
 * `a.split('.').map(Number)`, so `"0.64.1 (5b84188)"` yields `NaN` on the last segment and
 * the comparison reports the server as OLDER than 0.64.0. Hence a parser of our own.
 */

/** The release that re-encoded existing ids. */
export const REID_MIN_VERSION = { major: 0, minor: 64, patch: 0 } as const;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** What to do about this server. */
export type ReidVerdict =
  /** 0.64.0 or later: run once. */
  | 'run'
  /** Below 0.64.0, or not Navidrome at all. */
  | 'skip'
  /** The version string has no number to read: ask the user. */
  | 'ask';

/**
 * Read the leading `X.Y[.Z]` of a Navidrome version string, ignoring everything after it
 * (`-SNAPSHOT`, ` (sha)`, `-develop`, `+build`, …). `null` when the string does not start
 * with a version number (`dev`, `master (9ed35cb)`, empty), and for `0.0.0`, which
 * Navidrome's build reports when it cannot find a release tag
 * (`reference/navidrome/Makefile:12`) and so is not a version.
 */
export function parseNavidromeVersion(raw: string | null | undefined): ParsedVersion | null {
  if (!raw) return null;
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw.trim());
  if (!match) return null;
  const parsed = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
  if (parsed.major === 0 && parsed.minor === 0 && parsed.patch === 0) return null;
  return parsed;
}

/** `a` compared to `b`: negative, zero or positive. */
function compare(a: ParsedVersion, b: { major: number; minor: number; patch: number }): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Should the re-key run against this server? One rule for every build: `run` at 0.64.0 or
 * later, `skip` below it or for any other server type, `ask` when the version has no
 * number to read. Only `ask` shows the user a choice.
 */
export function navidromeReidVerdict(
  serverType: string | null | undefined,
  serverVersion: string | null | undefined,
): ReidVerdict {
  if (serverType?.toLowerCase() !== 'navidrome') return 'skip';
  const parsed = parseNavidromeVersion(serverVersion);
  if (parsed === null) return 'ask';
  return compare(parsed, REID_MIN_VERSION) >= 0 ? 'run' : 'skip';
}

/** Convenience for the callers that only care whether it runs unattended. */
export function serverNeedsReid(
  serverType: string | null | undefined,
  serverVersion: string | null | undefined,
): boolean {
  return navidromeReidVerdict(serverType, serverVersion) === 'run';
}
