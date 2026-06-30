import React from 'react';
import { tokens } from '@ui/design-system/tokens';
import { calculatePasswordStrength, strengthLabel, strengthColor } from '@shared/utils';
import type { PasswordStrength } from '@core/vault/types';
import type { BaseComponentProps } from '@shared/types';

type PasswordStrengthMeterProps = BaseComponentProps & {
  password: string;
  showLabel?: boolean;
};

const strengthBars: Record<PasswordStrength, number> = {
  weak: 1,
  fair: 2,
  strong: 3,
  maximum: 4,
};

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({
  password,
  showLabel = true,
  className,
  ...props
}) => {
  const strength = password ? calculatePasswordStrength(password) : null;
  const bars = strength ? strengthBars[strength] : 0;

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid={props['data-testid']}>
      {showLabel && strength && (
        <span style={{
          fontFamily: tokens.typography.fontFamily,
          fontSize: tokens.typography.sizes.xs,
          color: strengthColor(strength),
          fontWeight: tokens.typography.weights.medium,
        }}>
          Força: {strengthLabel(strength)}
        </span>
      )}
      <div style={{ display: 'flex', gap: '3px' }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              backgroundColor: i < bars ? strengthColor(strength!) : tokens.colors.neutral3,
              borderRadius: '2px',
              transition: 'background-color 300ms',
            }}
          />
        ))}
      </div>
    </div>
  );
};
