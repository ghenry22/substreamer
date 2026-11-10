jest.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#ff6600',
      textPrimary: '#ffffff',
      textSecondary: '#888888',
      border: '#333333',
      card: '#1e1e1e',
      inputBg: '#2a2a2a',
    },
  }),
}));

// Passthrough BottomSheet: renders children only while visible (mirrors the
// real primitive's unmount-when-hidden behaviour) without gesture-handler.
jest.mock('../../BottomSheet', () => {
  const { View } = require('react-native');
  return {
    BottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View testID="bottom-sheet">{children}</View> : null,
  };
});

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { listeningOnLabel } from '../copy';
import { RoutePickerSheet } from '../RoutePickerSheet';
import { useRoutePickerStore } from '../useRoutePickerStore';

const rnqp = require('react-native-queue-player');

/** Settle the discovery promise that the mounted content kicks off on mount. */
const flush = () => act(async () => {});

describe('RoutePickerSheet', () => {
  beforeEach(() => {
    rnqp.Cast.startDiscovery.mockClear();
    rnqp.Cast.stopDiscovery.mockClear();
    rnqp.Cast.requestLocalNetworkPermission.mockClear();
    rnqp.Cast.getLocalNetworkPermissionState.mockReturnValue('granted');
    rnqp.__setCastSnapshot({});
    act(() => useRoutePickerStore.getState().close());
  });

  it('renders nothing while closed', async () => {
    render(<RoutePickerSheet />);
    expect(screen.queryByTestId('bottom-sheet')).toBeNull();
    expect(rnqp.Cast.startDiscovery).not.toHaveBeenCalled();
    await flush();
  });

  it('mounts the picker content and starts discovery when opened', async () => {
    act(() => useRoutePickerStore.getState().open());
    render(<RoutePickerSheet />);
    expect(screen.getByTestId('bottom-sheet')).toBeTruthy();
    expect(screen.getByText(listeningOnLabel())).toBeTruthy();
    // Discovery is scoped to the open sheet (mounted inner content only).
    expect(rnqp.Cast.startDiscovery).toHaveBeenCalled();
    // Already granted: no probe (and no prompt) needed.
    expect(rnqp.Cast.requestLocalNetworkPermission).not.toHaveBeenCalled();
    await flush();
  });

  it('runs the local-network probe when the permission is not yet granted', async () => {
    rnqp.Cast.getLocalNetworkPermissionState.mockReturnValue('undetermined');
    act(() => useRoutePickerStore.getState().open());
    render(<RoutePickerSheet />);
    expect(rnqp.Cast.requestLocalNetworkPermission).toHaveBeenCalledTimes(1);
    await flush();
  });

  it('explains the denied state and offers Open Settings & Allow when local network is denied', async () => {
    rnqp.__setCastSnapshot({ permission: 'denied' });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    act(() => useRoutePickerStore.getState().open());
    render(<RoutePickerSheet />);
    expect(screen.getByText('Local Network Permission has not been granted.')).toBeTruthy();
    expect(
      screen.getByText('XXW Music needs this to be able to find Chromecast receivers on your network.'),
    ).toBeTruthy();
    expect(screen.getByText('Open Settings & Allow')).toBeTruthy();
    fireEvent.press(screen.getByTestId('route-picker-open-settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
    await flush();
  });

  it('stops discovery when the sheet closes (content unmounts)', async () => {
    act(() => useRoutePickerStore.getState().open());
    const { rerender } = render(<RoutePickerSheet />);
    expect(rnqp.Cast.startDiscovery).toHaveBeenCalled();
    act(() => useRoutePickerStore.getState().close());
    rerender(<RoutePickerSheet />);
    expect(rnqp.Cast.stopDiscovery).toHaveBeenCalled();
    await flush();
  });

  it('offers the in-app prompt, not Settings, when permission was never asked', async () => {
    // iOS only lists an app under Privacy > Local Network once it has ASKED. Sending an
    // un-asked user to Settings lands them on a screen with no entry to toggle.
    rnqp.Cast.getLocalNetworkPermissionState.mockReturnValue('undetermined');
    rnqp.__setCastSnapshot({ permission: 'undetermined' });
    act(() => useRoutePickerStore.getState().open());
    render(<RoutePickerSheet />);

    expect(screen.queryByTestId('route-picker-open-settings')).toBeNull();
    fireEvent.press(screen.getByTestId('route-picker-request-permission'));
    expect(rnqp.Cast.requestLocalNetworkPermission).toHaveBeenCalled();
    await flush();
  });
});
