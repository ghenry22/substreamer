jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      card: '#1c1c1e',
      primary: '#3478f6',
      textPrimary: '#fff',
      textSecondary: '#888',
      border: '#333',
    },
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: { name: string }) => <Text>{props.name}</Text> };
});

const mockChangeLanguage = jest.fn().mockResolvedValue(undefined);

jest.mock('../../i18n', () => ({
  i18n: {
    language: 'en',
    changeLanguage: (...args: unknown[]) => mockChangeLanguage(...args),
  },
}));

let sheetOnClose: (() => void) | null = null;

jest.mock('../BottomSheet', () => {
  const { View } = require('react-native');
  return {
    BottomSheet: ({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) => {
      sheetOnClose = onClose;
      return visible ? <View testID="language-sheet">{children}</View> : null;
    },
  };
});

import { localeStore } from '../../store/localeStore';

const { LanguageSelector } = require('../LanguageSelector');

beforeEach(() => {
  localeStore.setState({ locale: null });
  mockChangeLanguage.mockClear();
  sheetOnClose = null;
});

describe('LanguageSelector', () => {
  it('renders with "Language" label', () => {
    const { getByText } = render(<LanguageSelector />);
    expect(getByText('Language')).toBeTruthy();
  });

  it('renders globe icon', () => {
    const { getByText } = render(<LanguageSelector />);
    expect(getByText('globe-outline')).toBeTruthy();
  });

  it('shows "Device default" when locale is null', () => {
    const { getByText } = render(<LanguageSelector />);
    expect(getByText('Device default')).toBeTruthy();
  });

  it('shows language native name when locale is set', () => {
    localeStore.setState({ locale: 'en' });
    const { getByText } = render(<LanguageSelector />);
    expect(getByText('English')).toBeTruthy();
  });

  it('shows chevron-down icon', () => {
    const { getByText } = render(<LanguageSelector />);
    expect(getByText('chevron-down')).toBeTruthy();
  });

  it('opens bottom sheet on press', () => {
    const { getByText, getByTestId } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    expect(getByTestId('language-sheet')).toBeTruthy();
  });

  it('shows "Device default" option in sheet', () => {
    const { getByText, getAllByText } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    const matches = getAllByText('Device default');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('shows language options in sheet', () => {
    const { getByText } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    expect(getByText('English')).toBeTruthy();
  });

  it('shows checkmark next to "Device default" when locale is null', () => {
    const { getByText, getAllByText } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    const checkmarks = getAllByText('checkmark');
    expect(checkmarks.length).toBeGreaterThanOrEqual(1);
  });

  it('selecting a language calls setLocale and changeLanguage', () => {
    const { getByText } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    fireEvent.press(getByText('English'));
    expect(localeStore.getState().locale).toBe('en');
    expect(mockChangeLanguage).toHaveBeenCalledWith('en');
  });

  it('selecting "Device default" sets locale to null and calls changeLanguage with "en"', () => {
    localeStore.setState({ locale: 'en' });
    const { getByText, getAllByText } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    const defaults = getAllByText('Device default');
    fireEvent.press(defaults[defaults.length - 1]);
    expect(localeStore.getState().locale).toBeNull();
    expect(mockChangeLanguage).toHaveBeenCalledWith('en');
  });

  it('closes sheet after selecting a language', () => {
    const { getByText, queryByTestId } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    expect(queryByTestId('language-sheet')).toBeTruthy();
    fireEvent.press(getByText('English'));
    expect(queryByTestId('language-sheet')).toBeNull();
  });

  it('renders with login variant palette', () => {
    const { getByText } = render(<LanguageSelector variant="login" />);
    expect(getByText('Language')).toBeTruthy();
    expect(getByText('Device default')).toBeTruthy();
  });

  it('shows checkmark next to selected language when locale is set', () => {
    localeStore.setState({ locale: 'en' });
    const { getByText, getAllByText } = render(<LanguageSelector />);
    fireEvent.press(getByText('Language'));
    const checkmarks = getAllByText('checkmark');
    expect(checkmarks.length).toBeGreaterThanOrEqual(1);
  });
});
