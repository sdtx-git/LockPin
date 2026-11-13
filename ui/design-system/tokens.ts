// ===== Cores – apontam para as variáveis de tema (global.css) =====
export const colors = {
  neutral0:  'var(--canvas)',
  neutral1:  'var(--canvas)',
  neutral2:  'var(--surface)',
  neutral3:  'var(--border)',
  neutral4:  'var(--border-strong)',
  neutral5:  'var(--text-4)',
  neutral6:  'var(--text-3)',
  neutral7:  'var(--text-3)',
  neutral8:  'var(--text-2)',
  neutral9:  'var(--text-2)',
  neutral10: 'var(--text)',
  neutral11: 'var(--text)',
  neutral12: 'var(--text)',

  primary:    'var(--accent)',
  primaryDim: 'var(--accent-soft)',
  primaryHover: 'var(--accent-hover)',
  primaryActive: 'var(--accent-hover)',

  error:      'var(--danger)',
  errorDim:   'var(--danger-soft)',
  success:    'var(--success)',
  successDim: 'var(--success-soft)',
  warning:    'var(--warning)',
  warningDim: 'var(--warning-soft)',

  overlay50:  'var(--overlay)',
  overlay70:  'var(--overlay)',
} as const;

// ===== Tipografia =====
export const typography = {
  fontFamily: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMono: "'IBM Plex Mono', ui-monospace, Consolas, monospace",

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
  shadowSm:  '0 1px 2px rgba(0, 0, 0, 0.06)',
  shadowMd:  'var(--shadow-pop)',
  shadowLg:  'var(--shadow-pop)',
  shadowXl:  'var(--shadow-pop)',
  glowPrimary: 'none',
  glowError: 'none',
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
