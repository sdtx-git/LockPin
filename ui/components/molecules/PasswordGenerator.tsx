import React, { useState, useEffect } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { Button } from '@ui/components/atoms';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { calculatePasswordStrength, strengthLabel } from '@shared/utils';
import { CLIPBOARD_CLEAR_MS } from '@shared/constants';
import type { BaseComponentProps } from '@shared/types';

type PasswordGeneratorProps = BaseComponentProps & {
  onPasswordGenerated?: (password: string) => void;
  compact?: boolean;
};

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS    = '0123456789';
const SYMBOLS   = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const AMBIGUOUS = 'Il1O0';

const STRENGTH_COLORS = { weak: 'var(--danger)', fair: 'var(--warning)', strong: 'var(--success)', maximum: 'var(--success)' };
const STRENGTH_WIDTH  = { weak: '25%', fair: '50%', strong: '75%', maximum: '100%' };

// Inteiro uniforme em [0, max) por amostragem com rejeição (sem viés de módulo).
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % max;
}

function charGroups(upper: boolean, lower: boolean, digits: boolean, symbols: boolean, noAmbig: boolean): string[] {
  const groups = [upper && UPPERCASE, lower && LOWERCASE, digits && DIGITS, symbols && SYMBOLS].filter(Boolean) as string[];
  if (!noAmbig) return groups;
  return groups.map(g => g.split('').filter(c => !AMBIGUOUS.includes(c)).join(''));
}

function generate(length: number, groups: string[]): string {
  const charset = groups.join('');
  // um caractere de cada grupo marcado, o resto do conjunto todo
  const chars = groups.slice(0, length).map(g => g[randomInt(g.length)]);
  while (chars.length < length) chars.push(charset[randomInt(charset.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export const PasswordGenerator: React.FC<PasswordGeneratorProps> = ({
  onPasswordGenerated,
  compact = false,
}) => {
  const [length,       setLength]       = useState(20);
  const [useUpper,     setUseUpper]     = useState(true);
  const [useLower,     setUseLower]     = useState(true);
  const [useDigits,    setUseDigits]    = useState(true);
  const [useSymbols,   setUseSymbols]   = useState(true);
  const [noAmbig,      setNoAmbig]      = useState(false);
  const [password,     setPassword]     = useState('');
  const [copied,       setCopied]       = useState(false);
  const [spinning,     setSpinning]     = useState(false);

  const groups = charGroups(useUpper, useLower, useDigits, useSymbols, noAmbig);
  const enabledCount = [useUpper, useLower, useDigits, useSymbols].filter(Boolean).length;

  // Gera ao montar e sempre que as opções mudam
  useEffect(() => {
    setPassword(generate(length, groups));
  }, [length, useUpper, useLower, useDigits, useSymbols, noAmbig]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = async () => {
    try {
      await writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      setTimeout(() => writeText('').catch(() => {}), CLIPBOARD_CLEAR_MS);
    } catch { /* clipboard indisponível */ }
  };

  const handleRefresh = () => {
    setSpinning(true);
    setPassword(generate(length, groups));
    setTimeout(() => setSpinning(false), 600);
  };

  const strength = password ? calculatePasswordStrength(password) : null;
  const entropy = Math.round(password.length * Math.log2(groups.join('').length));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16 }}>

      {/* Password display */}
      <div style={{
        borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'var(--fill)',
      }}>
        {/* Generated password */}
        <div style={{
          padding: compact ? '12px 14px' : '16px 18px',
          display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: compact ? '14px' : '16px',
            color: tokens.colors.neutral11,
            flex: 1, wordBreak: 'break-all', lineHeight: 1.4,
            userSelect: 'all', letterSpacing: '0.04em',
          }}>
            {password || '—'}
          </span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <IconBtn label={copied ? 'Copiado!' : 'Copiar'} onClick={handleCopy} active={copied}>
              {copied
                ? <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><polyline points="20 6 9 17 4 12"/></svg>
                : <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x={9} y={9} width={13} height={13} rx={2}/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              }
            </IconBtn>
            <IconBtn
              label="Gerar nova"
              onClick={handleRefresh}
              style={{ animation: spinning ? 'spin 0.6s ease' : 'none' }}
            >
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
            </IconBtn>
          </div>
        </div>

        {/* Strength bar */}
        {strength && (
          <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 3, background: 'var(--fill-hover)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: STRENGTH_WIDTH[strength],
                background: STRENGTH_COLORS[strength],
                borderRadius: 2,
                transition: 'width 0.3s ease, background 0.3s ease',
              }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>
              {strengthLabel(strength)}
            </span>
            {!compact && (
              <span style={{ fontFamily: tokens.typography.fontFamilyMono, fontSize: '10px', color: tokens.colors.neutral6, flexShrink: 0 }}>
                ~{entropy} bits
              </span>
            )}
          </div>
        )}
      </div>

      {/* Length slider */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral7 }}>
            Tamanho
          </span>
          <span style={{
            fontFamily: tokens.typography.fontFamilyMono, fontSize: '13px',
            fontWeight: 600, color: tokens.colors.neutral10,

          }}>
            {length}
          </span>
        </div>
        <input
          type="range" min={8} max={64} value={length}
          onChange={e => setLength(Number(e.target.value))}
          style={{ width: '100%', accentColor: tokens.colors.primary, cursor: 'pointer', height: 4 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: tokens.colors.neutral6 }}>8</span>
          <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: tokens.colors.neutral6 }}>64</span>
        </div>
      </div>

      {/* Options */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: compact ? 6 : 8 }}>
        <ToggleChip label="Maiúsculas (A-Z)" on={useUpper} onChange={setUseUpper} disabled={useUpper && enabledCount === 1} />
        <ToggleChip label="Minúsculas (a-z)" on={useLower} onChange={setUseLower} disabled={useLower && enabledCount === 1} />
        <ToggleChip label="Números (0-9)" on={useDigits} onChange={setUseDigits} disabled={useDigits && enabledCount === 1} />
        <ToggleChip label="Símbolos (!@#)" on={useSymbols} onChange={setUseSymbols} disabled={useSymbols && enabledCount === 1} />
        <div style={{ gridColumn: 'span 2' }}>
          <ToggleChip label="Evitar caracteres parecidos (I, l, 1, O, 0)" on={noAmbig} onChange={setNoAmbig} />
        </div>
      </div>

      {/* Use button */}
      {onPasswordGenerated && (
        <Button variant="secondary" fullWidth onClick={() => onPasswordGenerated(password)}>
          Usar esta senha
        </Button>
      )}
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ToggleChip({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check" title={disabled ? 'Pelo menos um conjunto precisa ficar marcado' : undefined}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function IconBtn({ children, label, onClick, active, style: extraStyle }: {
  children: React.ReactNode; label: string;
  onClick: () => void; active?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="icon-btn"
      style={{ color: active ? 'var(--success)' : undefined, ...extraStyle }}>
      {children}
    </button>
  );
}
