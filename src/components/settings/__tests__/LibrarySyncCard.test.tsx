import i18n from '../../../i18n/i18n';
jest.mock('../../../store/persistence/kvStorage', () =>
  require('../../../store/persistence/__mocks__/kvStorage'),
);

jest.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#ff6600',
      textPrimary: '#ffffff',
      textSecondary: '#888888',
      border: '#333333',
      card: '#1e1e1e',
    },
  }),
}));

jest.mock('../../../services/dataSyncService', () => ({
  forceFullResync: jest.fn(),
  resumeSync: jest.fn(),
  cancelAllSyncs: jest.fn(),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';

import { LibrarySyncCard } from '../LibrarySyncCard';
import { forceFullResync } from '../../../services/dataSyncService';
import { migrationGateStore } from '../../../store/migrationGateStore';
import { offlineModeStore } from '../../../store/offlineModeStore';

const mockResync = forceFullResync as jest.Mock;

describe('LibrarySyncCard — a deferred re-key', () => {
  beforeEach(() => {
    mockResync.mockClear();
    migrationGateStore.getState().setDeferred(false);
    offlineModeStore.setState({ offlineMode: false });
  });

  // The control. Without this the "does nothing" assertion below would also pass
  // against a card whose button never worked at all.
  it('syncs normally when nothing is pending', () => {
    render(<LibrarySyncCard />);

    fireEvent.press(screen.getByText('Sync'));

    expect(mockResync).toHaveBeenCalled();
    expect(screen.queryByTestId('sync-card-reid-deferred')).toBeNull();
  });

  // A deferred pass blocks every library write for the session, so a Sync button that
  // still looked live would accept the tap and silently do nothing.
  it('explains itself and refuses to sync while the re-key is pending', () => {
    migrationGateStore.getState().setDeferred(true);
    render(<LibrarySyncCard />);

    expect(screen.getByTestId('sync-card-reid-deferred')).toBeTruthy();

    fireEvent.press(screen.getByText('Sync'));

    expect(mockResync).not.toHaveBeenCalled();
  });

  it('says the update failed when the user continued past a failed run', () => {
    migrationGateStore.getState().setDeferredAfterFailure();
    render(<LibrarySyncCard />);

    expect(screen.getByText(i18n.t('syncMigrationFailedPending'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('syncPendingLibraryUpdate'))).toBeNull();
  });

  it('says it is waiting for the server when the pass is deferred for want of one', () => {
    migrationGateStore.getState().setDeferred(true);
    render(<LibrarySyncCard />);

    expect(screen.getByText(i18n.t('syncPendingLibraryUpdate'))).toBeTruthy();
  });
});
