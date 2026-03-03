import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

import { themeColors, type ResolvedTheme, type ThemeColors } from '../constants/theme';
import { themeStore } from '../store/themeStore';

export function useTheme(): {
  theme: ResolvedTheme;
  colors: ThemeColors;
  preference: 'light' | 'dark' | 'system';
  primaryColor: string | null;
  setThemePreference: (p: 'light' | 'dark' | 'system') => void;
  setPrimaryColor: (color: string | null) => void;
} {
  const systemScheme = useColorScheme();
  const preference = themeStore((s) => s.themePreference);
  const setThemePreference = themeStore((s) => s.setThemePreference);
  const primaryColor = themeStore((s) => s.primaryColor);
  const setPrimaryColor = themeStore((s) => s.setPrimaryColor);

  const theme: ResolvedTheme = useMemo(
    () => (preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference),
    [preference, systemScheme]
  );

  const colors: ThemeColors = useMemo(() => {
    const baseColors = themeColors[theme];
    return primaryColor ? { ...baseColors, primary: primaryColor } : baseColors;
  }, [theme, primaryColor]);

  return { theme, colors, preference, primaryColor, setPrimaryColor, setThemePreference };
}
