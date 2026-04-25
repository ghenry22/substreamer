jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import { serverInfoStore } from '../../store/serverInfoStore';
import { canUserScan, canUserShare, isAdminRoleUnknown, supports } from '../serverCapabilityService';

function setServerInfo(overrides: {
	serverType?: string | null;
	apiVersion?: string | null;
	adminRole?: boolean | null;
	shareRole?: boolean | null;
}) {
	serverInfoStore.getState().setServerInfo({
		serverType: overrides.serverType ?? null,
		serverVersion: null,
		apiVersion: overrides.apiVersion ?? null,
		openSubsonic: overrides.serverType != null,
		extensions: [],
		lastFetchedAt: null,
		adminRole: overrides.adminRole ?? null,
		shareRole: overrides.shareRole ?? null,
		ignoredArticles: null,
	});
}

beforeEach(() => {
	serverInfoStore.getState().clearServerInfo();
});

describe('supports', () => {
	describe('Navidrome', () => {
		beforeEach(() => setServerInfo({ serverType: 'navidrome' }));

		it('supports all capabilities', () => {
			expect(supports('shares')).toBe(true);
			expect(supports('scan')).toBe(true);
			expect(supports('fullScan')).toBe(true);
			expect(supports('albumArtistRating')).toBe(true);
			expect(supports('internetRadioCrud')).toBe(true);
			expect(supports('structuredLyrics')).toBe(true);
		});
	});

	describe('Gonic', () => {
		beforeEach(() => setServerInfo({ serverType: 'gonic' }));

		it('supports albumArtistRating and structuredLyrics', () => {
			expect(supports('albumArtistRating')).toBe(true);
			expect(supports('structuredLyrics')).toBe(true);
		});

		it('does not support shares, scan, fullScan, internetRadioCrud', () => {
			expect(supports('shares')).toBe(false);
			expect(supports('scan')).toBe(false);
			expect(supports('fullScan')).toBe(false);
			expect(supports('internetRadioCrud')).toBe(false);
		});
	});

	describe('Classic Subsonic at API 1.16.1', () => {
		beforeEach(() => setServerInfo({ apiVersion: '1.16.1' }));

		it('supports shares, scan, internetRadioCrud', () => {
			expect(supports('shares')).toBe(true);
			expect(supports('scan')).toBe(true);
			expect(supports('internetRadioCrud')).toBe(true);
		});

		it('does not support fullScan or albumArtistRating', () => {
			expect(supports('fullScan')).toBe(false);
			expect(supports('albumArtistRating')).toBe(false);
		});
	});

	describe('Classic Subsonic at API 1.16.0', () => {
		beforeEach(() => setServerInfo({ apiVersion: '1.16.0' }));

		it('supports shares, scan, internetRadioCrud', () => {
			expect(supports('shares')).toBe(true);
			expect(supports('scan')).toBe(true);
			expect(supports('internetRadioCrud')).toBe(true);
		});

		it('does not support fullScan or albumArtistRating', () => {
			expect(supports('fullScan')).toBe(false);
			expect(supports('albumArtistRating')).toBe(false);
		});
	});

	describe('Classic Subsonic at API 1.15.0', () => {
		beforeEach(() => setServerInfo({ apiVersion: '1.15.0' }));

		it('supports shares and scan', () => {
			expect(supports('shares')).toBe(true);
			expect(supports('scan')).toBe(true);
		});

		it('does not support internetRadioCrud, fullScan, or albumArtistRating', () => {
			expect(supports('internetRadioCrud')).toBe(false);
			expect(supports('fullScan')).toBe(false);
			expect(supports('albumArtistRating')).toBe(false);
		});
	});

	describe('Classic Subsonic at API 1.14.0', () => {
		beforeEach(() => setServerInfo({ apiVersion: '1.14.0' }));

		it('supports shares only', () => {
			expect(supports('shares')).toBe(true);
		});

		it('does not support scan, internetRadioCrud, fullScan, or albumArtistRating', () => {
			expect(supports('scan')).toBe(false);
			expect(supports('internetRadioCrud')).toBe(false);
			expect(supports('fullScan')).toBe(false);
			expect(supports('albumArtistRating')).toBe(false);
		});
	});

	describe('Classic Subsonic below API 1.14.0', () => {
		beforeEach(() => setServerInfo({ apiVersion: '1.13.0' }));

		it('does not support any capability', () => {
			expect(supports('shares')).toBe(false);
			expect(supports('scan')).toBe(false);
			expect(supports('internetRadioCrud')).toBe(false);
			expect(supports('fullScan')).toBe(false);
			expect(supports('albumArtistRating')).toBe(false);
		});
	});

	describe('No server info', () => {
		it('returns false for all capabilities', () => {
			expect(supports('shares')).toBe(false);
			expect(supports('scan')).toBe(false);
			expect(supports('fullScan')).toBe(false);
			expect(supports('albumArtistRating')).toBe(false);
			expect(supports('internetRadioCrud')).toBe(false);
		});
	});

	describe('Case insensitivity', () => {
		it('matches Navidrome case-insensitively', () => {
			setServerInfo({ serverType: 'Navidrome' });
			expect(supports('shares')).toBe(true);
			expect(supports('fullScan')).toBe(true);
		});

		it('matches GONIC case-insensitively', () => {
			setServerInfo({ serverType: 'GONIC' });
			expect(supports('albumArtistRating')).toBe(true);
			expect(supports('shares')).toBe(false);
		});

		it('matches Nextcloud Music case-insensitively', () => {
			setServerInfo({ serverType: 'Nextcloud Music' });
			expect(supports('albumArtistRating')).toBe(true);
			expect(supports('shares')).toBe(false);
		});

		it('matches AMPACHE case-insensitively', () => {
			setServerInfo({ serverType: 'AMPACHE' });
			expect(supports('albumArtistRating')).toBe(true);
			expect(supports('shares')).toBe(false);
		});
	});

	describe('Nextcloud Music', () => {
		beforeEach(() => setServerInfo({ serverType: 'nextcloud music' }));

		it('supports albumArtistRating and structuredLyrics', () => {
			expect(supports('albumArtistRating')).toBe(true);
			expect(supports('structuredLyrics')).toBe(true);
		});

		it('does not support shares, scan, fullScan, internetRadioCrud', () => {
			expect(supports('shares')).toBe(false);
			expect(supports('scan')).toBe(false);
			expect(supports('fullScan')).toBe(false);
			expect(supports('internetRadioCrud')).toBe(false);
		});
	});

	describe('Ampache', () => {
		beforeEach(() => setServerInfo({ serverType: 'ampache' }));

		it('supports albumArtistRating and structuredLyrics', () => {
			expect(supports('albumArtistRating')).toBe(true);
			expect(supports('structuredLyrics')).toBe(true);
		});

		it('does not support shares, scan, fullScan, internetRadioCrud', () => {
			expect(supports('shares')).toBe(false);
			expect(supports('scan')).toBe(false);
			expect(supports('fullScan')).toBe(false);
			expect(supports('internetRadioCrud')).toBe(false);
		});
	});

	describe('structuredLyrics capability matrix', () => {
		it('Navidrome supports structuredLyrics', () => {
			setServerInfo({ serverType: 'navidrome' });
			expect(supports('structuredLyrics')).toBe(true);
		});

		it('Gonic supports structuredLyrics', () => {
			setServerInfo({ serverType: 'gonic' });
			expect(supports('structuredLyrics')).toBe(true);
		});

		it('Nextcloud Music supports structuredLyrics', () => {
			setServerInfo({ serverType: 'nextcloud music' });
			expect(supports('structuredLyrics')).toBe(true);
		});

		it('Ampache supports structuredLyrics', () => {
			setServerInfo({ serverType: 'ampache' });
			expect(supports('structuredLyrics')).toBe(true);
		});

		it('classic Subsonic does not support structuredLyrics', () => {
			setServerInfo({ apiVersion: '1.16.1' });
			expect(supports('structuredLyrics')).toBe(false);
		});

		it('no server info does not support structuredLyrics', () => {
			expect(supports('structuredLyrics')).toBe(false);
		});
	});

	describe('Unknown OpenSubsonic server', () => {
		it('falls through to API version gating', () => {
			setServerInfo({ serverType: 'funkwhale', apiVersion: '1.16.0' });
			expect(supports('shares')).toBe(true);
			expect(supports('scan')).toBe(true);
			expect(supports('internetRadioCrud')).toBe(true);
			expect(supports('fullScan')).toBe(false);
			expect(supports('albumArtistRating')).toBe(false);
		});

		it('returns false with no API version', () => {
			setServerInfo({ serverType: 'funkwhale' });
			expect(supports('shares')).toBe(false);
		});
	});
});

describe('canUserScan', () => {
	it('returns true when admin and scan supported', () => {
		setServerInfo({ serverType: 'navidrome', adminRole: true });
		expect(canUserScan()).toBe(true);
	});

	it('returns false when adminRole is false', () => {
		setServerInfo({ serverType: 'navidrome', adminRole: false });
		expect(canUserScan()).toBe(false);
	});

	it('returns true when adminRole is null (unknown)', () => {
		setServerInfo({ serverType: 'navidrome', adminRole: null });
		expect(canUserScan()).toBe(true);
	});

	it('returns false when scan not supported, regardless of role', () => {
		setServerInfo({ serverType: 'gonic', adminRole: true });
		expect(canUserScan()).toBe(false);
	});

	it('returns false when scan not supported and role is null', () => {
		setServerInfo({ serverType: 'gonic', adminRole: null });
		expect(canUserScan()).toBe(false);
	});

	it('returns false when scan not supported and role is false', () => {
		setServerInfo({ serverType: 'gonic', adminRole: false });
		expect(canUserScan()).toBe(false);
	});
});

describe('canUserShare', () => {
	it('returns true when shareRole and shares supported', () => {
		setServerInfo({ serverType: 'navidrome', shareRole: true });
		expect(canUserShare()).toBe(true);
	});

	it('returns false when shareRole is false', () => {
		setServerInfo({ serverType: 'navidrome', shareRole: false });
		expect(canUserShare()).toBe(false);
	});

	it('returns true when shareRole is null (unknown)', () => {
		setServerInfo({ serverType: 'navidrome', shareRole: null });
		expect(canUserShare()).toBe(true);
	});

	it('returns false when shares not supported, regardless of role', () => {
		setServerInfo({ serverType: 'gonic', shareRole: true });
		expect(canUserShare()).toBe(false);
	});

	it('returns false when shares not supported and role is null', () => {
		setServerInfo({ serverType: 'gonic', shareRole: null });
		expect(canUserShare()).toBe(false);
	});

	it('returns false when shares not supported and role is false', () => {
		setServerInfo({ serverType: 'gonic', shareRole: false });
		expect(canUserShare()).toBe(false);
	});
});

describe('isAdminRoleUnknown', () => {
	it('returns true when scan supported and adminRole is null', () => {
		setServerInfo({ serverType: 'navidrome', adminRole: null });
		expect(isAdminRoleUnknown()).toBe(true);
	});

	it('returns false when adminRole is true', () => {
		setServerInfo({ serverType: 'navidrome', adminRole: true });
		expect(isAdminRoleUnknown()).toBe(false);
	});

	it('returns false when adminRole is false', () => {
		setServerInfo({ serverType: 'navidrome', adminRole: false });
		expect(isAdminRoleUnknown()).toBe(false);
	});

	it('returns false when scan not supported', () => {
		setServerInfo({ serverType: 'gonic', adminRole: null });
		expect(isAdminRoleUnknown()).toBe(false);
	});
});
