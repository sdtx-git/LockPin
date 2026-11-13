import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { tokens as darkTokens } from '@ui/design-system/tokens';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  tokens: typeof darkTokens;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  tokens: darkTokens,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('lockpin-theme') as Theme | null;
    const initial = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', initial);
    return initial;
  });

  useEffect(() => {
    localStorage.setItem('lockpin-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({ theme, toggle, tokens: darkTokens }), [theme, toggle]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
