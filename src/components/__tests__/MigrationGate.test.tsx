jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      card: '#111',
      textPrimary: '#fff',
      textSecondary: '#888',
      border: '#333',
      primary: '#1D9BF0',
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
let mockProbedVersion: string | null = 'dev';
jest.mock('../../services/navidromeReid/reidMarker', () => ({
  probedServerVersion: () => mockProbedVersion,
  currentServerInfo: () => ({ serverType: 'navidrome', serverVersion: 'persisted' }),
}));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import i18n from '../../i18n/i18n';
import { migrationGateStore } from '../../store/migrationGateStore';
import { MigrationGate } from '../MigrationGate';

beforeEach(() => {
  migrationGateStore.getState().reset();
  mockProbedVersion = 'dev';
});

describe('MigrationGate asking screen', () => {
  it('shows the version the server reported', () => {
    migrationGateStore.getState().show('asking');
    const screen = render(<MigrationGate />);

    expect(screen.getByText(i18n.t('migrationAskBody', { version: 'dev' }))).toBeTruthy();
  });

  it('falls back to the persisted version when the probe has none', () => {
    mockProbedVersion = null;
    migrationGateStore.getState().show('asking');
    const screen = render(<MigrationGate />);

    expect(screen.getByText(i18n.t('migrationAskBody', { version: 'persisted' }))).toBeTruthy();
  });

  it('wires Update now and Run in legacy mode to their handlers', () => {
    const onConfirm = jest.fn();
    const onLegacy = jest.fn();
    migrationGateStore.getState().show('asking');
    const screen = render(<MigrationGate onConfirm={onConfirm} onLegacy={onLegacy} />);

    fireEvent.press(screen.getByTestId('migration-gate-ask-confirm'));
    fireEvent.press(screen.getByTestId('migration-gate-ask-legacy'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onLegacy).toHaveBeenCalledTimes(1);
  });
});

describe('MigrationGate failure screen', () => {
  it('offers Continue without updating only before the first write', () => {
    const onContinue = jest.fn();
    migrationGateStore.getState().show('working');
    migrationGateStore.getState().fail();
    const screen = render(<MigrationGate onContinue={onContinue} />);

    fireEvent.press(screen.getByTestId('migration-gate-continue'));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('hides Continue once the run has written', () => {
    migrationGateStore.getState().show('working');
    migrationGateStore.getState().markWritten();
    migrationGateStore.getState().fail();
    const screen = render(<MigrationGate />);

    expect(screen.queryByTestId('migration-gate-continue')).toBeNull();
  });
});
