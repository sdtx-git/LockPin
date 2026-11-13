import React, { useState, useCallback, useEffect, useRef } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { Button } from '@ui/components/atoms';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { calculatePasswordStrength, strengthLabel } from '@shared/utils';
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

function generate(length: number, upper: boolean, lower: boolean, digits: boolean, symbols: boolean, noAmbig: boolean): string {
  let charset = '';
  if (upper)   charset += UPPERCASE;
  if (lower)   charset += LOWERCASE;
  if (digits)  charset += DIGITS;
  if (symbols) charset += SYMBOLS;
  if (noAmbig) charset = charset.split('').filter(c => !AMBIGUOUS.includes(c)).join('');
  if (!charset) charset = LOWERCASE + DIGITS;

  const bytes = new Uint8Array(length * 3);
  crypto.getRandomValues(bytes);
  const mask = (1 << Math.ceil(Math.log2(charset.length))) - 1;
  let result = '';
  let i = 0;
  while (result.length < length && i < bytes.length - 1) {
    const rand = (bytes[i] << 8) | bytes[i + 1];
    i += 2;
    const idx = rand & mask;
    if (idx < charset.length) result += charset[idx];
  }
  while (result.length < length) result += charset[bytes[i++ % bytes.length] % charset.length];
  return result;
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
  const mountRef = useRef(false);

  const regenerate = useCallback((notify = true) => {
    const pwd = generate(length, useUpper, useLower, useDigits, useSymbols, noAmbig);
    setPassword(pwd);
    if (notify) onPasswordGenerated?.(pwd);
    return pwd;
  }, [length, useUpper, useLower, useDigits, useSymbols, noAmbig, onPasswordGenerated]);

  // Generate once on mount (no notify)
  useEffect(() => {
    if (mountRef.current) return;
    mountRef.current = true;
    const pwd = generate(length, useUpper, useLower, useDigits, useSymbols, noAmbig);
    setPassword(pwd);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate when options change (after mount)
  useEffect(() => {
    if (!mountRef.current) return;
    const pwd = generate(length, useUpper, useLower, useDigits, useSymbols, noAmbig);
    setPassword(pwd);
  }, [length, useUpper, useLower, useDigits, useSymbols, noAmbig]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = async () => {
    await writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleRefresh = () => {
    setSpinning(true);
    regenerate(true);
    setTimeout(() => setSpinning(false), 600);
  };

  const strength = password ? calculatePasswordStrength(password) : null;
  const entropy = Math.round(password.length * Math.log2(
    (useUpper ? 26 : 0) + (useLower ? 26 : 0) + (useDigits ? 10 : 0) + (useSymbols ? SYMBOLS.length : 0) || 36
  ));

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
        <ToggleChip label="Maiúsculas (A-Z)" on={useUpper} onChange={setUseUpper} />
        <ToggleChip label="Minúsculas (a-z)" on={useLower} onChange={setUseLower} />
        <ToggleChip label="Números (0-9)" on={useDigits} onChange={setUseDigits} />
        <ToggleChip label="Símbolos (!@#)" on={useSymbols} onChange={setUseSymbols} />
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

function ToggleChip({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', padding: '4px 0' }}>
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }} />
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
