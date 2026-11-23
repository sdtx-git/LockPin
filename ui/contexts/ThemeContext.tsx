import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { tokens as darkTokens } from '@ui/design-system/tokens';

type Theme = 'dark' | 'light';
export type Palette = 'atual' | 'cofre' | 'tecnico' | 'mono' | 'contraste' | 'amoled' | 'floresta' | 'oceano' | 'ametista' | 'vinho' | 'terracota';

export const PALETTES: { id: Palette; label: string; description: string; swatches: string[] }[] = [
  { id: 'atual', label: 'Petróleo', description: 'A paleta original do LockPin.', swatches: ['#12222c', '#f3f5f6', '#1a6a85'] },
  { id: 'cofre', label: 'Cofre', description: 'Grafite quente com acento latão.', swatches: ['oklch(0.205 0.01 60)', 'oklch(0.965 0.006 75)', 'oklch(0.72 0.1 80)'] },
  { id: 'tecnico', label: 'Técnico', description: 'Neutros frios com verde-petróleo vivo.', swatches: ['oklch(0.2 0.02 240)', 'oklch(0.97 0.005 230)', 'oklch(0.62 0.11 195)'] },
  { id: 'mono', label: 'Monocromático', description: 'Só preto, branco e cinzas.', swatches: ['oklch(0.965 0.002 260)', 'oklch(1 0 0)', 'oklch(0.18 0.003 260)'] },
  { id: 'contraste', label: 'Alto contraste', description: 'Preto e branco puros, bordas fortes, texto AAA.', swatches: ['oklch(0 0 0)', 'oklch(1 0 0)', 'oklch(0.4 0.09 215)'] },
  { id: 'amoled', label: 'AMOLED', description: 'Preto puro no escuro, poupa bateria em telas OLED. Acento magenta.', swatches: ['oklch(0 0 0)', 'oklch(0.1 0 0)', 'oklch(0.74 0.19 350)'] },
  { id: 'floresta', label: 'Floresta', description: 'Fundos verdes com acento esmeralda.', swatches: ['oklch(0.26 0.05 160)', 'oklch(0.955 0.02 160)', 'oklch(0.5 0.11 155)'] },
  { id: 'oceano', label: 'Oceano', description: 'Azul-marinho profundo com azul vivo.', swatches: ['oklch(0.26 0.06 250)', 'oklch(0.955 0.02 245)', 'oklch(0.52 0.15 250)'] },
  { id: 'ametista', label: 'Ametista', description: 'Violeta saturado com acento roxo.', swatches: ['oklch(0.25 0.07 300)', 'oklch(0.955 0.02 300)', 'oklch(0.5 0.17 305)'] },
  { id: 'vinho', label: 'Vinho', description: 'Bordô quente com acento rosé.', swatches: ['oklch(0.25 0.07 15)', 'oklch(0.955 0.015 15)', 'oklch(0.48 0.15 15)'] },
  { id: 'terracota', label: 'Terracota', description: 'Argila e areia com laranja queimado.', swatches: ['oklch(0.27 0.05 40)', 'oklch(0.955 0.02 60)', 'oklch(0.52 0.15 40)'] },
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
