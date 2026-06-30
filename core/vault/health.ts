import type { VaultData, VaultHealth } from './types';
import { calculatePasswordStrength } from '@shared/utils';

function isWeakPassword(password: string): boolean {
  const s = calculatePasswordStrength(password);
  return s === 'weak';
}

function strengthScore(password: string): number {
  const s = calculatePasswordStrength(password);
  return { weak: 20, fair: 45, strong: 70, maximum: 95 }[s];
}

export function computeHealth(vault: VaultData): VaultHealth {
  let weak = 0;
  let reused = 0;
  let compromised = 0;
  let totpWithout2fa = 0;
  let expired = 0;
  const seen = new Set<string>();
  const dupeSet = new Set<string>();

  for (const item of vault.items) {
    if (!item.password) continue;

    if (isWeakPassword(item.password)) weak++;

    if (seen.has(item.password)) { dupeSet.add(item.password); }
    seen.add(item.password);

    if (!item.totpSeed) {
      totpWithout2fa++;
    }
  }

  reused = dupeSet.size;

  return {
    weak,
    reused,
    compromised,
    totpWithout2fa,
    expired,
    total: vault.items.length,
    score: calcScore(vault.items.length, weak, reused, compromised, totpWithout2fa, expired),
  };
}

function calcScore(total: number, weak: number, reused: number, compromised: number, totpWithout2fa: number, expired: number): number {
  if (total === 0) return 100;
  const deductions =
    (weak * 15) +
    (reused * 10) +
    (compromised * 25) +
    (totpWithout2fa * 5) +
    (expired * 10);
  return Math.max(0, Math.min(100, 100 - Math.round(deductions / total)));
}

export function strongPasswords(vault: VaultData): number {
  return vault.items.filter(i => i.password && strengthScore(i.password) >= 70).length;
}

export function weakPasswords(vault: VaultData): string[] {
  return vault.items.filter(i => i.password && isWeakPassword(i.password)).map(i => i.title);
}
