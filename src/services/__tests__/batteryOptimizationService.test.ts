jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

const mockIsBatteryOptimizationEnabledAsync = jest.fn();
jest.mock('expo-battery', () => ({
  isBatteryOptimizationEnabledAsync: (...args: unknown[]) => mockIsBatteryOptimizationEnabledAsync(...args),
}));

const mockStartActivityAsync = jest.fn();
jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: (...args: unknown[]) => mockStartActivityAsync(...args),
  ActivityAction: {
    REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    IGNORE_BATTERY_OPTIMIZATION_SETTINGS: 'IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      android: { package: 'com.test.app' },
    },
  },
}));

import { Platform } from 'react-native';

import { batteryOptimizationStore } from '../../store/batteryOptimizationStore';
import {
  checkBatteryOptimization,
  requestBatteryOptimizationExemption,
} from '../batteryOptimizationService';

beforeEach(() => {
  jest.clearAllMocks();
  batteryOptimizationStore.setState({ restricted: null });
});

describe('checkBatteryOptimization', () => {
  it('returns false on iOS without calling native', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios' as typeof Platform.OS;

    const result = await checkBatteryOptimization();

    expect(result).toBe(false);
    expect(mockIsBatteryOptimizationEnabledAsync).not.toHaveBeenCalled();
    Platform.OS = originalOS;
  });

  it('returns true and updates store when battery optimization is enabled on Android', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android' as typeof Platform.OS;
    mockIsBatteryOptimizationEnabledAsync.mockResolvedValue(true);

    const result = await checkBatteryOptimization();

    expect(result).toBe(true);
    expect(batteryOptimizationStore.getState().restricted).toBe(true);
    Platform.OS = originalOS;
  });

  it('returns false and updates store when battery optimization is disabled on Android', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android' as typeof Platform.OS;
    mockIsBatteryOptimizationEnabledAsync.mockResolvedValue(false);

    const result = await checkBatteryOptimization();

    expect(result).toBe(false);
    expect(batteryOptimizationStore.getState().restricted).toBe(false);
    Platform.OS = originalOS;
  });

  it('returns false on native error', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android' as typeof Platform.OS;
    mockIsBatteryOptimizationEnabledAsync.mockRejectedValue(new Error('Native error'));

    const result = await checkBatteryOptimization();

    expect(result).toBe(false);
    Platform.OS = originalOS;
  });
});

describe('requestBatteryOptimizationExemption', () => {
  it('is a no-op on iOS', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios' as typeof Platform.OS;

    await requestBatteryOptimizationExemption();

    expect(mockStartActivityAsync).not.toHaveBeenCalled();
    Platform.OS = originalOS;
  });

  it('launches the battery optimization intent on Android', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android' as typeof Platform.OS;
    mockStartActivityAsync.mockResolvedValue(undefined);
    mockIsBatteryOptimizationEnabledAsync.mockResolvedValue(false);

    await requestBatteryOptimizationExemption();

    expect(mockStartActivityAsync).toHaveBeenCalledWith(
      'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: 'package:com.test.app' },
    );
    Platform.OS = originalOS;
  });

  it('falls back to settings list when direct dialog fails', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android' as typeof Platform.OS;
    mockStartActivityAsync
      .mockRejectedValueOnce(new Error('Dialog not available'))
      .mockResolvedValueOnce(undefined);
    mockIsBatteryOptimizationEnabledAsync.mockResolvedValue(false);

    await requestBatteryOptimizationExemption();

    expect(mockStartActivityAsync).toHaveBeenCalledTimes(2);
    expect(mockStartActivityAsync).toHaveBeenNthCalledWith(
      2,
      'IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    );
    Platform.OS = originalOS;
  });

  it('silently handles fallback failure', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android' as typeof Platform.OS;
    mockStartActivityAsync
      .mockRejectedValueOnce(new Error('Dialog not available'))
      .mockRejectedValueOnce(new Error('Settings not available'));
    mockIsBatteryOptimizationEnabledAsync.mockResolvedValue(true);

    await expect(requestBatteryOptimizationExemption()).resolves.toBeUndefined();
    Platform.OS = originalOS;
  });

  it('re-checks battery optimization status after dialog', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android' as typeof Platform.OS;
    mockStartActivityAsync.mockResolvedValue(undefined);
    mockIsBatteryOptimizationEnabledAsync.mockResolvedValue(false);

    await requestBatteryOptimizationExemption();

    expect(mockIsBatteryOptimizationEnabledAsync).toHaveBeenCalled();
    expect(batteryOptimizationStore.getState().restricted).toBe(false);
    Platform.OS = originalOS;
  });
});
