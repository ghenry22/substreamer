jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');

import { getShares, deleteShare } from '../../services/subsonicService';
import { sharesStore } from '../sharesStore';

const mockGetShares = getShares as jest.MockedFunction<typeof getShares>;
const mockDeleteShare = deleteShare as jest.MockedFunction<typeof deleteShare>;

beforeEach(() => {
  jest.clearAllMocks();
  sharesStore.setState({ shares: [], loading: false, error: null, notAvailable: false });
});

const makeShare = (id: string) => ({ id, url: `https://example.com/${id}` } as any);

describe('sharesStore', () => {
  describe('fetchShares', () => {
    it('fetches and stores shares', async () => {
      mockGetShares.mockResolvedValue({ ok: true, shares: [makeShare('s1')] });
      await sharesStore.getState().fetchShares();
      expect(sharesStore.getState().shares).toEqual([makeShare('s1')]);
      expect(sharesStore.getState().loading).toBe(false);
      expect(sharesStore.getState().notAvailable).toBe(false);
    });

    it('sets notAvailable when sharing is not available', async () => {
      mockGetShares.mockResolvedValue({
        ok: false,
        reason: 'not-available',
        message: 'Sharing is not enabled.',
      });
      await sharesStore.getState().fetchShares();
      expect(sharesStore.getState().notAvailable).toBe(true);
      expect(sharesStore.getState().error).toBe('Sharing is not enabled.');
      expect(sharesStore.getState().shares).toEqual([]);
      expect(sharesStore.getState().loading).toBe(false);
    });

    it('sets error on connection failure', async () => {
      mockGetShares.mockResolvedValue({
        ok: false,
        reason: 'error',
        message: 'Could not connect to the server.',
      });
      await sharesStore.getState().fetchShares();
      expect(sharesStore.getState().error).toBe('Could not connect to the server.');
      expect(sharesStore.getState().notAvailable).toBe(false);
      expect(sharesStore.getState().loading).toBe(false);
    });

    it('clears previous notAvailable on successful fetch', async () => {
      sharesStore.setState({ notAvailable: true, error: 'old' });
      mockGetShares.mockResolvedValue({ ok: true, shares: [] });
      await sharesStore.getState().fetchShares();
      expect(sharesStore.getState().notAvailable).toBe(false);
      expect(sharesStore.getState().error).toBeNull();
    });
  });

  describe('removeShare', () => {
    it('removes share from list on success', async () => {
      sharesStore.setState({ shares: [makeShare('s1'), makeShare('s2')] });
      mockDeleteShare.mockResolvedValue(true);

      const result = await sharesStore.getState().removeShare('s1');

      expect(result).toBe(true);
      expect(sharesStore.getState().shares).toEqual([makeShare('s2')]);
    });

    it('keeps share in list on failure', async () => {
      sharesStore.setState({ shares: [makeShare('s1')] });
      mockDeleteShare.mockResolvedValue(false);

      const result = await sharesStore.getState().removeShare('s1');

      expect(result).toBe(false);
      expect(sharesStore.getState().shares).toEqual([makeShare('s1')]);
    });
  });

  describe('clear', () => {
    it('resets all state', () => {
      sharesStore.setState({
        shares: [makeShare('s1')],
        loading: true,
        error: 'err',
        notAvailable: true,
      });
      sharesStore.getState().clear();
      const state = sharesStore.getState();
      expect(state.shares).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.notAvailable).toBe(false);
    });
  });
});
