import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

// Light palette.
const light = {
  bg: '#F5F6F8',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#0B7A4B', // brand green
  primaryDark: '#095C39',
  danger: '#DC2626',
  owed: '#0B7A4B', // positive balance (they owe you)
  settled: '#6B7280',
  credit: '#DC2626', // negative amount (paid back)
  onPrimary: '#FFFFFF',
  subOnPrimary: '#D7F0E3',
  tintGreen: '#E3F1EA',
  tintRed: '#FCE8E8',
  avatarBg: '#E3F1EA',
  debugBg: '#EEEEEE',
  debugText: '#555555',
};

// Dark palette — AMOLED: true black backgrounds, not grey.
const dark = {
  bg: '#000000',
  card: '#0E0F11',
  text: '#F3F4F6',
  muted: '#9AA0A6',
  border: '#26282D',
  primary: '#0B7A4B',
  primaryDark: '#095C39',
  danger: '#F87171',
  owed: '#34D399', // brighter green reads better on black
  settled: '#9AA0A6',
  credit: '#F87171',
  onPrimary: '#FFFFFF',
  subOnPrimary: '#D7F0E3',
  tintGreen: 'rgba(52,211,153,0.14)',
  tintRed: 'rgba(248,113,113,0.14)',
  avatarBg: 'rgba(52,211,153,0.16)',
  debugBg: '#141414',
  debugText: '#9AA0A6',
};

export const palettes = { light, dark };

const ThemeContext = createContext({ colors: light, scheme: 'light' });

// Follows the system appearance (light/dark) by default.
export function ThemeProvider({ children }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const scheme = system === 'dark' ? 'dark' : 'light';
  const colors = scheme === 'dark' ? dark : light;
  return <ThemeContext.Provider value={{ colors, scheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

export const spacing = (n) => n * 4;
export const radius = { sm: 8, md: 12, lg: 16 };
