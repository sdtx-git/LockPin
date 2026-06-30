import React, { useState, useCallback, useEffect, useRef } from 'react';
import { tokens } from '@ui/design-system/tokens';
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

const STRENGTH_COLORS = { weak: '#d163a7', fair: '#fdab43', strong: '#4f98a3', maximum: '#6daa45' };
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
    await navigator.clipboard.writeText(password);
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
        borderRadius: 12, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.03)',
      }}>
        {/* Generated password */}
        <div style={{
          padding: compact ? '12px 14px' : '16px 18px',
          display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
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
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: STRENGTH_WIDTH[strength],
                background: `linear-gradient(90deg, ${STRENGTH_COLORS[strength]}80, ${STRENGTH_COLORS[strength]})`,
                borderRadius: 2,
                transition: 'width 0.3s ease, background 0.3s ease',
              }} />
            </div>
            <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: STRENGTH_COLORS[strength], flexShrink: 0 }}>
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
            background: 'rgba(79,152,163,0.12)', border: '1px solid rgba(79,152,163,0.2)',
            padding: '1px 8px', borderRadius: 6,
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
        <ToggleChip label="A-Z Maiúsculas" on={useUpper} onChange={setUseUpper} />
        <ToggleChip label="a-z Minúsculas" on={useLower} onChange={setUseLower} />
        <ToggleChip label="0-9 Números"    on={useDigits} onChange={setUseDigits} />
        <ToggleChip label="!@# Símbolos"   on={useSymbols} onChange={setUseSymbols} />
        <div style={{ gridColumn: 'span 2' }}>
          <ToggleChip label="Excluir ambíguos (I, l, 1, O, 0)" on={noAmbig} onChange={setNoAmbig} />
        </div>
      </div>

      {/* Use button */}
      {onPasswordGenerated && (
        <button
          onClick={() => onPasswordGenerated(password)}
          style={{
            width: '100%', padding: '10px', borderRadius: 10,
            background: 'rgba(79,152,163,0.15)', border: '1px solid rgba(79,152,163,0.3)',
            color: '#4f98a3', fontFamily: tokens.typography.fontFamily,
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(79,152,163,0.25)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(79,152,163,0.15)'; }}
        >
          Usar esta senha
        </button>
      )}
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ToggleChip({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
        border: `1px solid ${on ? 'rgba(79,152,163,0.35)' : 'rgba(255,255,255,0.07)'}`,
        background: on ? 'rgba(79,152,163,0.12)' : 'rgba(255,255,255,0.03)',
        display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left',
        transition: 'all 0.15s',
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: 4, flexShrink: 0,
        border: `1.5px solid ${on ? '#4f98a3' : 'rgba(255,255,255,0.2)'}`,
        background: on ? '#4f98a3' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.13s',
      }}>
        {on && <svg width={8} height={8} viewBox="0 0 12 12" fill="none" stroke="#000" strokeWidth={2.2}><polyline points="2 6 5 9 10 3"/></svg>}
      </div>
      <span style={{
        fontFamily: tokens.typography.fontFamily, fontSize: '11px',
        color: on ? tokens.colors.neutral10 : tokens.colors.neutral7,
        transition: 'color 0.13s', lineHeight: 1.3,
      }}>
        {label}
      </span>
    </button>
  );
}

function IconBtn({ children, label, onClick, active, style: extraStyle }: {
  children: React.ReactNode; label: string;
  onClick: () => void; active?: boolean;
  style?: React.CSSProperties;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button" onClick={onClick} aria-label={label} title={label}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30, height: 30, borderRadius: 8, border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'rgba(109,170,69,0.18)' : hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        color: active ? '#6daa45' : hov ? tokens.colors.neutral11 : tokens.colors.neutral7,
        cursor: 'pointer', transition: 'all 0.13s',
        ...extraStyle,
      }}
    >
      {children}
    </button>
  );
}
