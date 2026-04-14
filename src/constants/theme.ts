export type ResolvedTheme = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  label: string;
  border: string;
  primary: string;
  red: string;
  green: string;
  orange: string;
  inputBg: string;
}

export const lightTheme: ThemeColors = {
  background: '#f5f5f5',
  card: '#ffffff',
  textPrimary: '#121212',
  textSecondary: '#535353',
  label: '#6b6b6b',
  border: 'rgba(0,0,0,0.08)',
  primary: '#1D9BF0',
  red: '#e91429',
  green: '#34C759',
  orange: '#FF9500',
  inputBg: '#e5e5e5',
};

export const darkTheme: ThemeColors = {
  background: '#121212',
  card: '#181818',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  label: '#888888',
  border: 'rgba(255,255,255,0.06)',
  primary: '#1D9BF0',
  red: '#e91429',
  green: '#30D158',
  orange: '#FF9F0A',
  inputBg: '#282828',
};

export const themeColors: Record<ResolvedTheme, ThemeColors> = {
  light: lightTheme,
  dark: darkTheme,
};
