import React from 'react';
import { cn } from '@shared/utils';
import type { BaseComponentProps, DisableableProps, LoadableProps, Size, Variant } from '@shared/types';

type ButtonProps = BaseComponentProps & DisableableProps & LoadableProps & {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'base',
  fullWidth = false,
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  className,
  ...props
}) => (
  <button
    type={type}
    disabled={disabled || loading}
    onClick={onClick}
    className={cn('btn', `btn--${variant}`, size !== 'base' && `btn--${size}`, fullWidth && 'btn--full', className)}
    data-testid={props['data-testid']}
    id={props.id}
  >
    {loading && <Spinner size={size} />}
    {children}
  </button>
);

function Spinner({ size }: { size: Size }) {
  const dim = size === 'xs' || size === 'sm' ? 14 : size === 'base' ? 16 : 20;
  return (
    <svg width={dim} height={dim} viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity={0.25} />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" fill="none" opacity={0.75} />
    </svg>
  );
}
