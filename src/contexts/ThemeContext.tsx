// ============================================================
// Soulmate - 主题上下文 (深色/浅色模式)
// ============================================================
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSecondary: string;
  card: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  userBubble: string;
  userBubbleText: string;
  aiBubble: string;
  aiBubbleText: string;
  separator: string;
  overlay: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  inputBackground: string;
  inputText: string;
  inputPlaceholder: string;
  thinkingBg: string;
  thinkingText: string;
  thinkingBorder: string;
  toastBg: string;
  toastText: string;
  blurBg: string;
  inputBorder: string;
  codeBg: string;
  codeText: string;
  codeBorder: string;
  inputBg: string;
  fileCardBg: string;
  fileCardBorder: string;
  tabBarBg: string;
  statusBarStyle: 'dark' | 'light';
}

const THEME_STORAGE_KEY = '@agentfile_theme_mode';
const CUSTOM_THEME_KEY = '@soulmate_custom_theme';

// --- 浅色主题配色 ---
export const lightColors: ThemeColors = {
  background: '#F7F7F7',
  surface: '#FFFFFF',
  surfaceSecondary: '#F2F2F7',
  card: '#FFFFFF',
  text: '#1C1C1E',
  textSecondary: '#636366',
  textTertiary: '#AEAEB2',
  textInverse: '#FFFFFF',
  primary: '#3B82F6',
  primaryLight: '#93C5FD',
  primaryDark: '#1D4ED8',
  userBubble: '#3B82F6',
  userBubbleText: '#FFFFFF',
  aiBubble: '#FFFFFF',
  aiBubbleText: '#1C1C1E',
  thinkingBg: '#F0F4FF',
  thinkingText: '#636366',
  thinkingBorder: '#E5E7EB',
  codeBg: '#1E1E2E',
  codeText: '#CDD6F4',
  codeBorder: '#313244',
  inputBg: 'rgba(255,255,255,0.72)',
  inputBorder: '#E5E7EB',
  inputText: '#1C1C1E',
  inputPlaceholder: '#AEAEB2',
  success: '#34C759',
  error: '#FF3B30',
  warning: '#FF9500',
  info: '#5AC8FA',
  inputBackground: '#F2F2F7',
  toastBg: '#FFFFFF',
  toastText: '#1C1C1E',
  fileCardBg: '#F2F2F7',
  fileCardBorder: '#E5E7EB',
  blurBg: 'rgba(247,247,247,0.72)',
  separator: '#E5E5EA',
  overlay: 'rgba(0,0,0,0.4)',
  tabBarBg: '#FFFFFF',
  statusBarStyle: 'dark',
};

// --- 深色主题配色 ---
export const darkColors: ThemeColors = {
  background: '#1C1C1E',
  surface: '#2C2C2E',
  surfaceSecondary: '#3A3A3C',
  card: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#AEAEB2',
  textTertiary: '#636366',
  textInverse: '#1C1C1E',
  primary: '#5B9CF6',
  primaryLight: '#93C5FD',
  primaryDark: '#3B82F6',
  userBubble: '#3B82F6',
  userBubbleText: '#FFFFFF',
  aiBubble: '#2C2C2E',
  aiBubbleText: '#FFFFFF',
  thinkingBg: '#252530',
  thinkingText: '#AEAEB2',
  thinkingBorder: '#3A3A3C',
  codeBg: '#11111B',
  codeText: '#CDD6F4',
  codeBorder: '#313244',
  inputBg: 'rgba(44,44,46,0.72)',
  inputBorder: '#3A3A3C',
  inputText: '#FFFFFF',
  inputPlaceholder: '#636366',
  success: '#30D158',
  error: '#FF453A',
  warning: '#FF9F0A',
  info: '#5AC8FA',
  inputBackground: '#2C2C2E',
  toastBg: '#2C2C2E',
  toastText: '#FFFFFF',
  fileCardBg: '#3A3A3C',
  fileCardBorder: '#48484A',
  blurBg: 'rgba(28,28,30,0.72)',
  separator: '#38383A',
  overlay: 'rgba(0,0,0,0.6)',
  tabBarBg: '#2C2C2E',
  statusBarStyle: 'light',
};

// --- 情绪主题（深色沉浸）---
export const emotionColors: ThemeColors = {
  background: '#0A0A0A',
  surface: '#1A1A1A',
  surfaceSecondary: '#222222',
  card: '#1A1A1A',
  text: '#FFFFFF',
  textSecondary: '#888888',
  textTertiary: '#666666',
  textInverse: '#0A0A0A',
  primary: '#6B7FD6',
  primaryLight: '#8A9AE8',
  primaryDark: '#4A5EC4',
  userBubble: 'rgba(200,200,210,0.6)',
  userBubbleText: '#FFFFFF',
  aiBubble: 'rgba(200,200,210,0.6)',
  aiBubbleText: '#FFFFFF',
  thinkingBg: '#1A1A1A',
  thinkingText: '#808080',
  thinkingBorder: '#333333',
  codeBg: '#0D0D0D',
  codeText: '#CCCCCC',
  codeBorder: '#333333',
  inputBg: 'rgba(30,30,30,0.8)',
  inputBorder: '#333333',
  inputText: '#FFFFFF',
  inputPlaceholder: '#666666',
  success: '#34C759',
  error: '#FF453A',
  warning: '#FF9F0A',
  info: '#5AC8FA',
  inputBackground: '#222222',
  toastBg: '#1A1A1A',
  toastText: '#FFFFFF',
  fileCardBg: '#222222',
  fileCardBorder: '#333333',
  blurBg: 'rgba(10,10,10,0.85)',
  separator: '#333333',
  overlay: 'rgba(0,0,0,0.7)',
  tabBarBg: '#1A1A1A',
  statusBarStyle: 'light',
};

export type CustomTheme = 'default' | 'ocean' | 'sakura' | 'moonlight' | 'emotion';

interface ThemeContextType {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  customTheme: CustomTheme;
  setThemeMode: (mode: ThemeMode) => void;
  setCustomTheme: (theme: CustomTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'system',
  colors: lightColors,
  isDark: false,
  customTheme: 'default' as CustomTheme,
  setThemeMode: () => {},
  setCustomTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);
  const [customTheme, setCustomTheme] = useState<CustomTheme>('default');

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') setMode(saved);
        const savedTheme = await AsyncStorage.getItem(CUSTOM_THEME_KEY);
        if (savedTheme === 'default' || savedTheme === 'emotion' || savedTheme === 'ocean' || savedTheme === 'moonlight') {
          setCustomTheme(savedTheme as CustomTheme);
        }
      } catch { /* defaults */ }
      setLoaded(true);
    })();
  }, []);

  const setCustomThemePersisted = useCallback(async (theme: CustomTheme) => {
    setCustomTheme(theme);
    try { await AsyncStorage.setItem(CUSTOM_THEME_KEY, theme); } catch {}
  }, []);

  const setThemeMode = useCallback(async (newMode: ThemeMode) => {
    setMode(newMode);
    try { await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode); } catch {}
  }, []);

  const toggleTheme = useCallback(async () => {
    const resolved = mode === 'system' ? (systemScheme ?? 'light') : mode;
    const next = resolved === 'dark' ? 'light' : 'dark';
    await setThemeMode(next);
  }, [mode, systemScheme, setThemeMode]);

  const resolvedMode: 'light' | 'dark' =
    customTheme === 'emotion' ? 'dark' : (
    mode === 'system' || !loaded
      ? (systemScheme === 'dark' ? 'dark' : 'light')
      : mode);
  let colors: ThemeColors;
  if (customTheme === 'emotion') {
    colors = emotionColors;
  } else {
    colors = resolvedMode === 'dark' ? darkColors : lightColors;
  }
  const isDark = resolvedMode === 'dark';

  return (
    <ThemeContext.Provider
      value={{ mode, colors, isDark, customTheme, setThemeMode, setCustomTheme: setCustomThemePersisted, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

export default ThemeContext;
