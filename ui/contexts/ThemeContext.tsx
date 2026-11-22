import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { tokens as darkTokens } from '@ui/design-system/tokens';

type Theme = 'dark' | 'light';
export type Palette = 'atual' | 'cofre' | 'tecnico' | 'mono' | 'contraste';

export const PALETTES: { id: Palette; label: string; description: string; swatches: string[] }[] = [
  { id: 'atual', label: 'Petróleo', description: 'A paleta original do LockPin.', swatches: ['#12222c', '#f3f5f6', '#1a6a85'] },
  { id: 'cofre', label: 'Cofre', description: 'Grafite quente com acento latão.', swatches: ['oklch(0.205 0.01 60)', 'oklch(0.965 0.006 75)', 'oklch(0.72 0.1 80)'] },
  { id: 'tecnico', label: 'Técnico', description: 'Neutros frios com verde-petróleo vivo.', swatches: ['oklch(0.2 0.02 240)', 'oklch(0.97 0.005 230)', 'oklch(0.62 0.11 195)'] },
  { id: 'mono', label: 'Monocromático', description: 'Só preto, branco e cinzas.', swatches: ['oklch(0.965 0.002 260)', 'oklch(1 0 0)', 'oklch(0.18 0.003 260)'] },
  { id: 'contraste', label: 'Alto contraste', description: 'Preto e branco puros, bordas fortes, texto AAA.', swatches: ['oklch(0 0 0)', 'oklch(1 0 0)', 'oklch(0.4 0.09 215)'] },
];

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
  tokens: typeof darkTokens;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  setTheme: () => {},
  palette: 'atual',
  setPalette: () => {},
  tokens: darkTokens,
});

function savedPalette(): Palette {
  const saved = localStorage.getItem('lockpin-palette');
  return PALETTES.some(p => p.id === saved) ? (saved as Palette) : 'atual';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('lockpin-theme') as Theme | null;
    const initial = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', initial);
    return initial;
  });

  const [palette, setPalette] = useState<Palette>(() => {
    const initial = savedPalette();
    document.documentElement.setAttribute('data-palette', initial);
    return initial;
  });

  useEffect(() => {
    localStorage.setItem('lockpin-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('lockpin-palette', palette);
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette]);

  const toggle = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(
    () => ({ theme, toggle, setTheme, palette, setPalette, tokens: darkTokens }),
    [theme, toggle, palette],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
