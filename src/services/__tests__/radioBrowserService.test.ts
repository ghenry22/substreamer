import {
  CATALOG_PAGE_SIZE,
  catalogStationMeta,
  searchCatalogStations,
  toCatalogStation,
  type CatalogStation,
} from '../radioBrowserService';

const rawStation = {
  stationuuid: 'uuid-1',
  name: '  Jazz FM  ',
  url: 'https://stream.example/playlist.pls',
  url_resolved: 'https://stream.example/live.mp3',
  homepage: 'https://jazzfm.example',
  favicon: 'https://jazzfm.example/logo.png',
  tags: 'jazz,smooth',
  countrycode: 'PL',
  codec: 'MP3',
  bitrate: 128,
  votes: 42,
};

describe('toCatalogStation', () => {
  it('maps a raw record, preferring url_resolved and trimming the name', () => {
    const station = toCatalogStation(rawStation);
    expect(station).toEqual({
      id: 'uuid-1',
      name: 'Jazz FM',
      streamUrl: 'https://stream.example/live.mp3',
      homepage: 'https://jazzfm.example',
      favicon: 'https://jazzfm.example/logo.png',
      tags: 'jazz,smooth',
      countryCode: 'PL',
      codec: 'MP3',
      bitrate: 128,
      votes: 42,
    });
  });

  it('falls back to url when url_resolved is missing', () => {
    const station = toCatalogStation({ ...rawStation, url_resolved: undefined });
    expect(station?.streamUrl).toBe('https://stream.example/playlist.pls');
  });

  it('rejects records missing the essentials', () => {
    expect(toCatalogStation({ ...rawStation, stationuuid: undefined })).toBeNull();
    expect(toCatalogStation({ ...rawStation, name: '   ' })).toBeNull();
    expect(
      toCatalogStation({ ...rawStation, url: undefined, url_resolved: undefined }),
    ).toBeNull();
  });

  it('normalises empty optionals', () => {
    const station = toCatalogStation({
      stationuuid: 'uuid-2',
      name: 'X',
      url_resolved: 'https://x/live',
      homepage: '',
      favicon: '',
    });
    expect(station?.homepage).toBeNull();
    expect(station?.favicon).toBeNull();
    expect(station?.tags).toBe('');
    expect(station?.bitrate).toBe(0);
  });
});

describe('catalogStationMeta', () => {
  const base = toCatalogStation(rawStation) as CatalogStation;

  it('joins country, codec+bitrate and the first tag', () => {
    expect(catalogStationMeta(base)).toBe('PL • MP3 128 kbps • jazz');
  });

  it('omits missing parts', () => {
    expect(
      catalogStationMeta({ ...base, countryCode: '', bitrate: 0, tags: '' }),
    ).toBe('MP3');
  });
});

describe('searchCatalogStations', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, json: async () => body }) as unknown as Response;

  it('queries the directory and maps valid records', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse([rawStation, { stationuuid: 'broken' }]),
    );
    const stations = await searchCatalogStations('jazz', fetchMock);
    expect(stations).toHaveLength(1);
    expect(stations?.[0].id).toBe('uuid-1');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/stations/search?');
    expect(url).toContain('name=jazz');
    expect(url).toContain(`limit=${CATALOG_PAGE_SIZE}`);
    expect(url).toContain('hidebroken=true');
  });

  it('omits the name filter for an empty query (top stations)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse([]));
    await searchCatalogStations('   ', fetchMock);
    expect(fetchMock.mock.calls[0][0]).not.toContain('name=');
  });

  it('returns null on HTTP failure', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false } as Response);
    expect(await searchCatalogStations('x', fetchMock)).toBeNull();
  });

  it('returns null on network error', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await searchCatalogStations('x', fetchMock)).toBeNull();
  });

  it('returns null on a non-array payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse({ error: 'nope' }));
    expect(await searchCatalogStations('x', fetchMock)).toBeNull();
  });
});
