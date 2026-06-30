// ===== Cores – paleta sofisticada com dark mode nativo =====
export const colors = {
  neutral0:  '#0a0a0a',
  neutral1:  '#121212',
  neutral2:  '#1a1a1a',
  neutral3:  '#242424',
  neutral4:  '#2e2e2e',
  neutral5:  '#3a3a3a',
  neutral6:  '#505050',
  neutral7:  '#707070',
  neutral8:  '#909090',
  neutral9:  '#b0b0b0',
  neutral10: '#d0d0d0',
  neutral11: '#e8e8e8',
  neutral12: '#ffffff',

  primary:    '#4f98a3',
  primaryDim: '#2a5c66',
  primaryHover: '#3d7a84',
  primaryActive: '#2d5c66',

  error:      '#d163a7',
  errorDim:   '#8a2f6a',
  success:    '#6daa45',
  successDim: '#4a7a2e',
  warning:    '#fdab43',
  warningDim: '#c47a20',

  overlay50:  'rgba(10, 10, 10, 0.5)',
  overlay70:  'rgba(10, 10, 10, 0.7)',
} as const;

// ===== Tipografia =====
export const typography = {
  fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
  fontFamilyMono: 'JetBrains Mono, Fira Code, monospace',

  sizes: {
    xs:  '11px',
    sm:  '12px',
    base: '13px',
    lg:  '15px',
    xl:  '18px',
    xxl: '24px',
    xxxl: '32px',
  },

  weights: {
    regular: 400,
    medium:  500,
    semibold: 600,
    bold:    700,
  },

  lineHeights: {
    tight:   1.2,
    normal:  1.4,
    loose:   1.6,
  },

  letterSpacings: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.04em',
  },
} as const;

// ===== Espaçamento (4px base unit) =====
export const spacing = {
  0:  '0',
  px: '1px',
  1:  '4px',
  2:  '8px',
  3:  '12px',
  4:  '16px',
  5:  '24px',
  6:  '32px',
  7:  '48px',
  8:  '64px',
  9:  '96px',
} as const;

// ===== Raios =====
export const radii = {
  none: '0',
  sm:   '4px',
  md:   '6px',
  lg:   '10px',
  xl:   '16px',
  full: '9999px',
} as const;

// ===== Sombras =====
export const effects = {
  shadowSm:  '0 1px 2px rgba(0, 0, 0, 0.3)',
  shadowMd:  '0 4px 12px rgba(0, 0, 0, 0.4)',
  shadowLg:  '0 8px 32px rgba(0, 0, 0, 0.5)',
  shadowXl:  '0 16px 48px rgba(0, 0, 0, 0.6)',
  glowPrimary: '0 0 16px rgba(79, 152, 163, 0.4)',
  glowError: '0 0 16px rgba(209, 99, 167, 0.4)',
} as const;

// ===== Transições =====
export const transitions = {
  fast:   '100ms ease',
  normal: '200ms ease',
  slow:   '300ms ease',
  spring: '400ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
} as const;

// ===== Z-Index =====
export const zIndex = {
  base:     0,
  dropdown: 100,
  sticky:   200,
  modal:    300,
  toast:    400,
  tooltip:  500,
} as const;

// ===== Breakpoints =====
export const breakpoints = {
  sm:  '640px',
  md:  '768px',
  lg:  '1024px',
  xl:  '1280px',
  xxl: '1536px',
} as const;

// ===== Tema completo =====
export interface DesignTokens {
  colors: typeof colors;
  typography: typeof typography;
  spacing: typeof spacing;
  radii: typeof radii;
  effects: typeof effects;
  transitions: typeof transitions;
  zIndex: typeof zIndex;
  breakpoints: typeof breakpoints;
}

export const tokens: DesignTokens = {
  colors,
  typography,
  spacing,
  radii,
  effects,
  transitions,
  zIndex,
  breakpoints,
};
