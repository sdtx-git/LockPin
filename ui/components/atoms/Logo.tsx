import React from 'react';

// Marca: cadeado sobre bloco de acento.
export const Logo: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <span style={{
    width: size, height: size, borderRadius: size * 0.26, flexShrink: 0,
    background: 'var(--accent)', color: 'var(--on-accent)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }}>
    <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={4} y={11} width={16} height={10} rx={2.5} />
      <path d="M8 11V7.5a4 4 0 018 0V11" />
    </svg>
  </span>
);
