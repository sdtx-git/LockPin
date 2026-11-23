import React, { useId } from 'react';

const PINS: { x: number; top: number; driver: number; key: number }[] = [
  { x: 20.5, top: 24, driver: 27, key: 15 },
  { x: 33.5, top: 31, driver: 20, key: 8 },
  { x: 46, top: 20, driver: 31, key: 19 },
  { x: 58.5, top: 28, driver: 23, key: 12 },
  { x: 71.5, top: 34, driver: 17, key: 6 },
];

export const Logo: React.FC<{ size?: number; offsets?: number[] }> = ({ size = 28, offsets }) => {
  const id = `logo${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const brass = `${id}-brass`;
  const brassDark = `${id}-brass-dark`;
  return (
    <svg className="logo" width={size} height={size} viewBox="8 8 84 84" aria-hidden>
      <defs>
        <linearGradient id={brass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b9862c" />
          <stop offset="0.45" stopColor="#f3d58e" />
          <stop offset="1" stopColor="#a87623" />
        </linearGradient>
        <linearGradient id={brassDark} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8f6420" />
          <stop offset="0.45" stopColor="#d6a854" />
          <stop offset="1" stopColor="#7e561b" />
        </linearGradient>
      </defs>
      {PINS.map((p, i) => (
        <g key={p.x} className="logo__pin" style={{ transform: `translateY(${offsets?.[i] ?? 0}px)` }}>
          <rect x={p.x} y={p.top} width={8} height={p.driver} rx={4} fill={`url(#${brass})`} />
          <path d={`M${p.x} ${p.top + p.driver + 3.5}h8v${p.key}a4 4 0 0 1-8 0z`} fill={`url(#${brassDark})`} />
        </g>
      ))}
      <rect x={12} y={52.2} width={76} height={1.8} rx={0.9} fill="#5fb2cd" />
    </svg>
  );
};
