// kvStorage now delegates to the shared handle owned by db.ts. Tests
// inject a fake handle via db.ts's `__setDbForTests`; the in-memory
// fallback path is exercised by setting the handle to null.

import { __setDbForTests, kvFallback } from '../db';
import { kvStorage, clearKvStorage } from '../kvStorage';

describe('kvStorage (happy path)', () => {
  let mockGetFirstSync: jest.Mock;
  let mockRunSync: jest.Mock;

  beforeEach(() => {
    mockGetFirstSync = jest.fn();
    mockRunSync = jest.fn();
    __setDbForTests({
      getFirstSync: mockGetFirstSync,
      getAllSync: jest.fn(),
      runSync: mockRunSync,
      execSync: jest.fn(),
      withTransactionSync: jest.fn(),
    });
  });

  afterAll(() => {
    __setDbForTests(null);
  });

  describe('getItem', () => {
    it('returns value when row exists', () => {
      mockGetFirstSync.mockReturnValue({ value: '{"count":1}' });
      expect(kvStorage.getItem('my-key')).toBe('{"count":1}');
      expect(mockGetFirstSync).toHaveBeenCalledWith(
        'SELECT value FROM storage WHERE key = ?;',
        ['my-key'],
      );
    });

    it('returns null when row does not exist', () => {
      mockGetFirstSync.mockReturnValue(undefined);
      expect(kvStorage.getItem('missing')).toBeNull();
    });

    it('returns null when getFirstSync throws (per-call failure)', () => {
      mockGetFirstSync.mockImplementation(() => {
        throw new Error('disk i/o');
      });
      expect(kvStorage.getItem('any')).toBeNull();
    });
  });

  describe('setItem', () => {
    it('inserts or replaces the key-value pair', () => {
      kvStorage.setItem('my-key', '{"count":1}');
      expect(mockRunSync).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?);',
        ['my-key', '{"count":1}'],
      );
    });

    it('swallows runSync failures', () => {
      mockRunSync.mockImplementation(() => {
        throw new Error('disk full');
      });
      expect(() => kvStorage.setItem('any', 'v')).not.toThrow();
    });
  });

  describe('removeItem', () => {
    it('deletes the row by key', () => {
      kvStorage.removeItem('my-key');
      expect(mockRunSync).toHaveBeenCalledWith(
        'DELETE FROM storage WHERE key = ?;',
        ['my-key'],
      );
    });

    it('swallows runSync failures', () => {
      mockRunSync.mockImplementation(() => {
        throw new Error('disk i/o');
      });
      expect(() => kvStorage.removeItem('any')).not.toThrow();
    });
  });

  describe('clearKvStorage', () => {
    it('deletes every row from the storage table', () => {
      clearKvStorage();
      expect(mockRunSync).toHaveBeenCalledWith('DELETE FROM storage;');
    });

    it('swallows runSync failures', () => {
      mockRunSync.mockImplementation(() => {
        throw new Error('disk i/o');
      });
      expect(() => clearKvStorage()).not.toThrow();
    });
  });
});

describe('kvStorage (db unavailable → in-memory fallback)', () => {
  beforeEach(() => {
    __setDbForTests(null);
    kvFallback.clear();
  });

  it('round-trips values via the kvFallback Map', () => {
    kvStorage.setItem('alpha', 'one');
    kvStorage.setItem('beta', 'two');
    expect(kvStorage.getItem('alpha')).toBe('one');
    expect(kvStorage.getItem('beta')).toBe('two');
  });

  it('returns null for keys never set', () => {
    expect(kvStorage.getItem('never-set')).toBeNull();
  });

  it('removeItem deletes from the fallback Map', () => {
    kvStorage.setItem('gamma', 'three');
    kvStorage.removeItem('gamma');
    expect(kvStorage.getItem('gamma')).toBeNull();
  });

  it('clearKvStorage empties the fallback Map', () => {
    kvStorage.setItem('delta', 'four');
    kvStorage.setItem('epsilon', 'five');
    clearKvStorage();
    expect(kvStorage.getItem('delta')).toBeNull();
    expect(kvStorage.getItem('epsilon')).toBeNull();
  });
});
