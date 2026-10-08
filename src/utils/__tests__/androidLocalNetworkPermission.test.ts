jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 37 },
  PermissionsAndroid: {
    check: jest.fn(),
    request: jest.fn(),
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
  },
}));

import { PermissionsAndroid, Platform } from 'react-native';

import {
  ANDROID_LOCAL_NETWORK_PERMISSION,
  ensureAndroidLocalNetworkPermission,
} from '../androidLocalNetworkPermission';

const mockCheck = PermissionsAndroid.check as jest.Mock;
const mockRequest = PermissionsAndroid.request as jest.Mock;

describe('ensureAndroidLocalNetworkPermission', () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockRequest.mockReset();
    Platform.OS = 'android';
    Platform.Version = 37;
  });

  it('returns granted immediately off Android', async () => {
    Platform.OS = 'ios';
    expect(await ensureAndroidLocalNetworkPermission()).toBe('granted');
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('returns granted below API 37 without touching the platform', async () => {
    Platform.Version = 36;
    expect(await ensureAndroidLocalNetworkPermission()).toBe('granted');
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('does not prompt when the permission is already granted', async () => {
    mockCheck.mockResolvedValue(true);
    expect(await ensureAndroidLocalNetworkPermission()).toBe('granted');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('requests when not granted and reports the grant', async () => {
    mockCheck.mockResolvedValue(false);
    mockRequest.mockResolvedValue('granted');
    expect(await ensureAndroidLocalNetworkPermission()).toBe('granted');
    expect(mockRequest).toHaveBeenCalledWith(ANDROID_LOCAL_NETWORK_PERMISSION);
  });

  it('reports denied when the user refuses the prompt', async () => {
    mockCheck.mockResolvedValue(false);
    mockRequest.mockResolvedValue('denied');
    expect(await ensureAndroidLocalNetworkPermission()).toBe('denied');
  });

  it('fails open when the platform call throws', async () => {
    mockCheck.mockRejectedValue(new Error('boom'));
    expect(await ensureAndroidLocalNetworkPermission()).toBe('granted');
  });
});
