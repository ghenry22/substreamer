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
  /** Colour of the "partially downloaded" album/playlist indicator (the
   * header download button + every row/card partial badge). Its own semantic
   * token so the partial state is consistent everywhere and tunable in one
   * place, independent of the generic `orange`. */
  partialDownload: string;
  inputBg: string;
}

const lightTheme: ThemeColors = {
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
  partialDownload: '#FF9500',
  inputBg: '#e5e5e5',
};

export const darkTheme: ThemeColors = {
  background: '#0a0a0a',
  card: '#161616',
  textPrimary: '#ffffff',
  textSecondary: '#a8a8a8',
  label: '#8a8a8a',
  border: 'rgba(255,255,255,0.08)',
  primary: '#1D9BF0',
  red: '#e91429',
  green: '#30D158',
  orange: '#FF9F0A',
  partialDownload: '#FF9F0A',
  inputBg: '#232323',
};

export const themeColors: Record<ResolvedTheme, ThemeColors> = {
  light: lightTheme,
  dark: darkTheme,
};
