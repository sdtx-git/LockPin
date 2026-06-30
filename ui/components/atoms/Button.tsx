import React from 'react';
import { cn } from '@shared/utils';
import { tokens } from '@ui/design-system/tokens';
import type { BaseComponentProps, DisableableProps, LoadableProps, Size, Variant } from '@shared/types';

type ButtonProps = BaseComponentProps & DisableableProps & LoadableProps & {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
};

const sizeStyles: Record<Size, string> = {
  xs: `px-2 py-1 text-[${tokens.typography.sizes.xs}]`,
  sm: `px-3 py-1.5 text-[${tokens.typography.sizes.sm}]`,
  base: `px-4 py-2 text-[${tokens.typography.sizes.base}]`,
  lg: `px-5 py-2.5 text-[${tokens.typography.sizes.lg}]`,
  xl: `px-6 py-3 text-[${tokens.typography.sizes.xl}]`,
};

const variantStyles: Record<Variant, Record<string, string>> = {
  primary: {
    bg: tokens.colors.primary,
    hover: tokens.colors.primaryHover,
    active: tokens.colors.primaryActive,
    text: tokens.colors.neutral12,
  },
  secondary: {
    bg: tokens.colors.neutral3,
    hover: tokens.colors.neutral4,
    active: tokens.colors.neutral5,
    text: tokens.colors.neutral11,
  },
  danger: {
    bg: tokens.colors.error,
    hover: tokens.colors.errorDim,
    active: tokens.colors.errorDim,
    text: tokens.colors.neutral12,
  },
  ghost: {
    bg: 'transparent',
    hover: tokens.colors.neutral3,
    active: tokens.colors.neutral4,
    text: tokens.colors.neutral10,
  },
  outline: {
    bg: 'transparent',
    hover: tokens.colors.neutral3,
    active: tokens.colors.neutral4,
    text: tokens.colors.primary,
  },
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
}) => {
  const styles = variantStyles[variant];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral1',
        disabled && 'opacity-50 cursor-not-allowed',
        fullWidth && 'w-full',
        sizeStyles[size],
        className
      )}
      style={{
        backgroundColor: styles.bg,
        color: styles.text,
        border: variant === 'outline' ? `1px solid ${styles.text}` : 'none',
        fontFamily: tokens.typography.fontFamily,
        fontWeight: tokens.typography.weights.medium,
        borderRadius: tokens.radii.md,
      }}
      data-testid={props['data-testid']}
      id={props.id}
    >
      {loading && <Spinner size={size} />}
      {children}
    </button>
  );
};

function Spinner({ size }: { size: Size }) {
  const dim = size === 'xs' || size === 'sm' ? 14 : size === 'base' ? 16 : 20;
  return (
    <svg width={dim} height={dim} viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity={0.25} />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" fill="none" opacity={0.75} />
    </svg>
  );
}
