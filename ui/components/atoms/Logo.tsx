import React, { useId } from 'react';

// Marca: cadeado sólido com fechadura vazada sobre bloco em degradê do acento.
export const Logo: React.FC<{ size?: number }> = ({ size = 28 }) => {
  const mask = useId();
  return (
    <span className="logo" style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" aria-hidden>
        <defs>
          <mask id={mask}>
            <rect x={4.5} y={10} width={15} height={11.5} rx={3.2} fill="#fff" />
            <circle cx={12} cy={14.6} r={1.75} fill="#000" />
            <path d="M11.15 15.5h1.7l.45 3h-2.6z" fill="#000" />
          </mask>
        </defs>
        <path d="M7.75 10.5V7.75a4.25 4.25 0 0 1 8.5 0v2.75" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" />
        <rect x={4.5} y={10} width={15} height={11.5} rx={3.2} fill="currentColor" mask={`url(#${mask})`} />
      </svg>
    </span>
  );
};
