import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { tokens as darkTokens } from '@ui/design-system/tokens';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  tokens: typeof darkTokens;
}

const lightColors = {
  neutral0:  '#f8f8fa',
  neutral1:  '#f0f0f4',
  neutral2:  '#e8e8ee',
  neutral3:  '#dddde4',
  neutral4:  '#d0d0d8',
  neutral5:  '#b8b8c4',
  neutral6:  '#90909e',
  neutral7:  '#686878',
  neutral8:  '#484856',
  neutral9:  '#30303a',
  neutral10: '#202028',
  neutral11: '#14141a',
  neutral12: '#0a0a0f',
} as const;

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  tokens: darkTokens,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('lockpin-theme') as Theme) || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('lockpin-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => {
    if (theme === 'light') {
      const lt = { ...darkTokens, colors: { ...darkTokens.colors, ...lightColors } };
      return { theme, toggle, tokens: lt } as unknown as ThemeContextValue;
    }
    return { theme, toggle, tokens: darkTokens };
  }, [theme, toggle]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
