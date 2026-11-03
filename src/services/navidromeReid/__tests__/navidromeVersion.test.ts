import { navidromeReidVerdict, parseNavidromeVersion, serverNeedsReid } from '../navidromeVersion';

describe('parseNavidromeVersion', () => {
  it.each([
    ['0.64.0 (1072e9f7)', { major: 0, minor: 64, patch: 0 }],
    ['0.64.1 (5b84188)', { major: 0, minor: 64, patch: 1 }],
    ['0.63.2', { major: 0, minor: 63, patch: 2 }],
    ['0.65.0', { major: 0, minor: 65, patch: 0 }],
    ['v0.64.0 (abc1234)', { major: 0, minor: 64, patch: 0 }],
    ['0.64', { major: 0, minor: 64, patch: 0 }],
    ['1.0.0', { major: 1, minor: 0, patch: 0 }],
    ['  0.64.0 (deadbee)  ', { major: 0, minor: 64, patch: 0 }],
  ])('parses %s', (raw, expected) => {
    expect(parseNavidromeVersion(raw)).toEqual(expected);
  });

  // Whatever follows the leading number is ignored, whatever it is.
  it.each([
    ['0.64.2-SNAPSHOT (abc1234)', { major: 0, minor: 64, patch: 2 }],
    ['0.64.2-SNAPSHOT (pr-5867/ea1e2b95)', { major: 0, minor: 64, patch: 2 }],
    ['0.64.2-SNAPSHOT (source_archive)', { major: 0, minor: 64, patch: 2 }],
    ['0.63.2-SNAPSHOT (abc1234)', { major: 0, minor: 63, patch: 2 }],
    ['0.64.2 develop', { major: 0, minor: 64, patch: 2 }],
    ['0.64.2+build', { major: 0, minor: 64, patch: 2 }],
    ['0.64.0-master', { major: 0, minor: 64, patch: 0 }],
    ['0.64.0.1.2', { major: 0, minor: 64, patch: 0 }],
  ])('reads the leading number of %s', (raw, expected) => {
    expect(parseNavidromeVersion(raw)).toEqual(expected);
  });

  it.each([
    ['dev'], ['master (9ed35cb)'], [''], ['   '], ['nonsense'], [null], [undefined],
    // Navidrome's fallback when the build finds no release tag (Makefile:12).
    ['0.0.0-SNAPSHOT (abc1234)'], ['0.0.0'],
  ])('returns null for %s', (raw) => {
    expect(parseNavidromeVersion(raw as string | null | undefined)).toBeNull();
  });
});

describe('navidromeReidVerdict', () => {
  it.each([
    ['0.64.0 (1072e9f7)', 'run'],
    ['0.63.2 (abc1234)', 'skip'],
    ['0.64.2-SNAPSHOT (abc1234)', 'run'],
    ['0.64.2-SNAPSHOT (pr-5867/ea1e2b95)', 'run'],
    ['0.64.2-SNAPSHOT (source_archive)', 'run'],
    ['0.0.0-SNAPSHOT (abc1234)', 'ask'],
    ['0.63.2-SNAPSHOT (abc1234)', 'skip'],
    ['dev', 'ask'],
    ['master (9ed35cb)', 'ask'],
    ['0.64.2 develop', 'run'],
    ['0.64.2+build', 'run'],
    ['v0.64.0', 'run'],
    ['0.64', 'run'],
    ['', 'ask'],
    [null, 'ask'],
  ])('%s -> %s', (raw, verdict) => {
    expect(navidromeReidVerdict('navidrome', raw)).toBe(verdict);
  });

  it('ignores every other server type, whatever the version', () => {
    for (const type of ['gonic', 'airsonic', 'subsonic', 'ampache', '', null, undefined]) {
      expect(navidromeReidVerdict(type, '0.64.0')).toBe('skip');
      expect(navidromeReidVerdict(type, 'dev')).toBe('skip');
    }
  });

  it('matches the server type case-insensitively', () => {
    expect(serverNeedsReid('Navidrome', '0.64.0')).toBe(true);
    expect(serverNeedsReid('NAVIDROME', '0.64.0')).toBe(true);
  });

  it('would have been wrong under the existing compareVersions', () => {
    // `'0.64.1 (5b84188)'.split('.').map(Number)` yields NaN on the last segment, and
    // `NaN > 0` is false, so serverCapabilityService's comparator reports "older".
    const naive = '0.64.1 (5b84188)'.split('.').map(Number);
    expect(naive.some(Number.isNaN)).toBe(true);
    expect(serverNeedsReid('navidrome', '0.64.1 (5b84188)')).toBe(true);
  });
});
