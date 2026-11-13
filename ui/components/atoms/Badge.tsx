import React from 'react';
import { cn } from '@shared/utils';
import { tokens } from '@ui/design-system/tokens';
import type { BaseComponentProps } from '@shared/types';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

type BadgeProps = BaseComponentProps & {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
};

const variantStyles: Record<BadgeVariant, { bg: string; text: string }> = {
  default: { bg: 'var(--fill)', text: 'var(--text-2)' },
  success: { bg: 'var(--success-soft)', text: 'var(--success)' },
  warning: { bg: 'var(--warning-soft)', text: 'var(--warning)' },
  error: { bg: 'var(--danger-soft)', text: 'var(--danger)' },
  info: { bg: 'var(--accent-soft)', text: 'var(--accent)' },
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  dot = false,
  className,
  ...props
}) => {
  const styles = variantStyles[variant];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      style={{
        fontFamily: tokens.typography.fontFamily,
        fontSize: tokens.typography.sizes.xs,
        fontWeight: tokens.typography.weights.medium,
        backgroundColor: styles.bg,
        color: styles.text,
        padding: '2px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      }}
      data-testid={props['data-testid']}
    >
      {dot && (
        <span style={{
          width: 6,
          height: 6,
          backgroundColor: styles.text,
          borderRadius: '50%',
          display: 'inline-block',
        }}/>
      )}
      {children}
    </span>
  );
};
