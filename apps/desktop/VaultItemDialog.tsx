import React, { useState, useEffect, useCallback } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { PasswordGenerator } from '@ui/components/molecules';
import { calculatePasswordStrength, strengthColor, strengthLabel } from '@shared/utils';
import type { VaultItem, VaultItemType } from '@core/vault/types';

// ─── FormData (exported for vault.tsx) ────────────────────────────────────────

export interface FormData {
  type: VaultItemType;
  title: string;
  url: string;
  username: string;
  password: string;
  note: string;
  tags: string;
  favorite: boolean;
  totpSeed: string;
  card: { number: string; expiry: string; cvc: string; cardholder: string; brand: string };
  identity: { firstName: string; lastName: string; email: string; phone: string; address: string; document: string };
}

export const emptyForm = (): FormData => ({
  type: 'password', title: '', url: '', username: '', password: '',
  note: '', tags: '', favorite: false, totpSeed: '',
  card: { number: '', expiry: '', cvc: '', cardholder: '', brand: '' },
  identity: { firstName: '', lastName: '', email: '', phone: '', address: '', document: '' },
});

export function itemToForm(item: VaultItem): FormData {
  return {
    type: item.type,
    title: item.title,
    url: item.url ?? '',
    username: item.username ?? '',
    password: item.password ?? '',
    note: item.note ?? '',
    tags: item.tags.join(', '),
    favorite: item.favorite,
    totpSeed: item.totpSeed ?? '',
    card: { number: item.card?.number ?? '', expiry: item.card?.expiry ?? '', cvc: item.card?.cvc ?? '', cardholder: item.card?.cardholder ?? '', brand: item.card?.brand ?? '' },
    identity: { firstName: item.identity?.firstName ?? '', lastName: item.identity?.lastName ?? '', email: item.identity?.email ?? '', phone: item.identity?.phone ?? '', address: item.identity?.address ?? '', document: item.identity?.document ?? '' },
  };
}

// ─── Type config ──────────────────────────────────────────────────────────────

const TYPES: { key: VaultItemType; label: string; color: string }[] = [
  { key: 'password', label: 'Senha',      color: '#4f98a3' },
  { key: 'totp',     label: 'TOTP',       color: '#e87da0' },
  { key: 'card',     label: 'Cartão',     color: '#fdab43' },
  { key: 'note',     label: 'Nota',       color: '#9b7de8' },
  { key: 'identity', label: 'Identidade', color: '#6daa45' },
  { key: 'passkey',  label: 'Passkey',    color: '#63b3ff' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VaultItemDialogProps {
  open: boolean;
  form: FormData;
  onChange: (form: FormData) => void;
  editingItem: VaultItem | null;
  onSave: () => void;
  onClose: () => void;
  error?: string;
}

// ─── VaultItemDialog ──────────────────────────────────────────────────────────

export const VaultItemDialog: React.FC<VaultItemDialogProps> = ({
  open, form, onChange, editingItem, onSave, onClose, error,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const isEdit = editingItem !== null;

  // Close generator when type changes away from password
  useEffect(() => {
    if (form.type !== 'password') setShowGenerator(false);
  }, [form.type]);

  // Close password reveal when dialog closes
  useEffect(() => {
    if (!open) { setShowPassword(false); setShowGenerator(false); }
  }, [open]);

  const set = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    onChange({ ...form, [key]: value });
  }, [form, onChange]);

  const setCard = useCallback((k: keyof FormData['card'], v: string) => {
    onChange({ ...form, card: { ...form.card, [k]: v } });
  }, [form, onChange]);

  const setIdentity = useCallback((k: keyof FormData['identity'], v: string) => {
    onChange({ ...form, identity: { ...form.identity, [k]: v } });
  }, [form, onChange]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target instanceof HTMLInputElement) onSave();
    if (e.key === 'Escape') onClose();
  };

  if (!open) return null;

  const activeType = TYPES.find(t => t.key === form.type)!;

  return (
    <div
      role="dialog" aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: tokens.zIndex.modal,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(4,4,8,0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: 560,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          background: 'rgba(8,8,14,0.99)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          boxShadow: `0 48px 96px rgba(0,0,0,0.75), 0 0 0 1px ${activeType.color}18, inset 0 1px 0 rgba(255,255,255,0.06)`,
          overflow: 'hidden',
          animation: 'dialog-enter 0.22s cubic-bezier(0.16,1,0.3,1)',
        }}
        onKeyDown={handleKey}
      >
        {/* Accent top border */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${activeType.color}80, ${activeType.color}50, transparent)`,
          transition: 'background 0.3s',
        }} />

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 22px 0', flexShrink: 0,
        }}>
          <div>
            <h2 style={{
              fontFamily: tokens.typography.fontFamily, fontSize: '17px', fontWeight: 700,
              color: tokens.colors.neutral12, margin: 0, lineHeight: 1,
            }}>
              {isEdit ? 'Editar Item' : 'Novo Item'}
            </h2>
            {isEdit && (
              <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral6, marginTop: 4 }}>
                {editingItem.title}
              </p>
            )}
          </div>
          <button
            onClick={onClose} aria-label="Fechar"
            style={{
              width: 30, height: 30, borderRadius: 8, border: 'none',
              background: 'rgba(255,255,255,0.06)', color: tokens.colors.neutral6,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.13s',
            }}
            onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'rgba(255,255,255,0.12)'; b.style.color = '#fff'; }}
            onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'rgba(255,255,255,0.06)'; b.style.color = tokens.colors.neutral6; }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Type picker */}
        <div style={{ padding: '16px 22px 0', flexShrink: 0 }}>
          <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral6, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Tipo
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TYPES.map(t => {
              const active = form.type === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => set('type', t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '7px 12px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${active ? t.color + '50' : 'rgba(255,255,255,0.07)'}`,
                    background: active ? `${t.color}14` : 'rgba(255,255,255,0.03)',
                    transition: 'all 0.15s',
                  }}
                >
                  <TypeIcon type={t.key} size={14} color={active ? t.color : tokens.colors.neutral6} />
                  <span style={{
                    fontFamily: tokens.typography.fontFamily, fontSize: '12px', fontWeight: active ? 600 : 400,
                    color: active ? t.color : tokens.colors.neutral7,
                    transition: 'color 0.13s',
                  }}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
          <FormBody
            form={form}
            set={set}
            setCard={setCard}
            setIdentity={setIdentity}
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword(v => !v)}
            showGenerator={showGenerator}
            onToggleGenerator={() => setShowGenerator(v => !v)}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '0 22px 8px' }}>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: '#e87da0', background: 'rgba(232,125,160,0.08)', border: '1px solid rgba(232,125,160,0.2)', borderRadius: 8, padding: '8px 12px', margin: 0 }}>
              {error}
            </p>
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 22px', borderTop: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
            <FavoriteToggle on={form.favorite} onChange={v => set('favorite', v)} />
            <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral7 }}>
              Favorito
            </span>
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <GhostBtn onClick={onClose}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={onSave}>{isEdit ? 'Salvar' : 'Criar'}</PrimaryBtn>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes dialog-enter {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
};

// ─── FormBody ─────────────────────────────────────────────────────────────────

function FormBody({ form, set, setCard, setIdentity, showPassword, onTogglePassword, showGenerator, onToggleGenerator }: {
  form: FormData;
  set: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  setCard: (k: keyof FormData['card'], v: string) => void;
  setIdentity: (k: keyof FormData['identity'], v: string) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  showGenerator: boolean;
  onToggleGenerator: () => void;
}) {
  const strength = form.password ? calculatePasswordStrength(form.password) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Common: Title */}
      <Section label="Informações">
        <Field label="Título" required>
          <Inp
            value={form.title}
            onChange={v => set('title', v)}
            placeholder={titlePlaceholder(form.type)}
            autoFocus
          />
        </Field>

        {(form.type === 'password' || form.type === 'totp') && (
          <Field label="URL do site">
            <Inp value={form.url} onChange={v => set('url', v)} placeholder="https://..." />
          </Field>
        )}
      </Section>

      {/* Password */}
      {form.type === 'password' && (
        <Section label="Credenciais">
          <Field label="Usuário / Email">
            <Inp value={form.username} onChange={v => set('username', v)} placeholder="usuario@email.com" />
          </Field>

          <Field label="Senha" required>
            <div style={{ position: 'relative' }}>
              <Inp
                value={form.password}
                onChange={v => set('password', v)}
                type={showPassword ? 'text' : 'password'}
                placeholder="Senha mestra"
                style={{ paddingRight: 72 }}
              />
              <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4 }}>
                <SmallIconBtn label={showPassword ? 'Ocultar' : 'Mostrar'} onClick={onTogglePassword}>
                  {showPassword
                    ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>
                    : <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx={12} cy={12} r={3}/></svg>
                  }
                </SmallIconBtn>
                <SmallIconBtn
                  label="Gerar senha"
                  onClick={onToggleGenerator}
                  active={showGenerator}
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                </SmallIconBtn>
              </div>
            </div>

            {/* Strength */}
            {form.password && strength && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: { weak: '25%', fair: '50%', strong: '75%', maximum: '100%' }[strength],
                    background: strengthColor(strength),
                    borderRadius: 2, transition: 'width 0.3s, background 0.3s',
                  }} />
                </div>
                <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: strengthColor(strength), flexShrink: 0 }}>
                  {strengthLabel(strength)}
                </span>
              </div>
            )}
          </Field>

          {/* Inline generator */}
          {showGenerator && (
            <div style={{
              padding: 16, borderRadius: 12,
              background: 'rgba(79,152,163,0.05)',
              border: '1px solid rgba(79,152,163,0.15)',
              animation: 'dialog-enter 0.18s ease',
            }}>
              <PasswordGenerator
                compact
                onPasswordGenerated={pwd => set('password', pwd)}
              />
            </div>
          )}
        </Section>
      )}

      {/* TOTP */}
      {form.type === 'totp' && (
        <Section label="Autenticador">
          <Field label="Usuário / Email">
            <Inp value={form.username} onChange={v => set('username', v)} placeholder="usuario@email.com" />
          </Field>
          <Field label="Semente TOTP (Base32)" required>
            <Inp
              value={form.totpSeed}
              onChange={v => set('totpSeed', v.toUpperCase().replace(/[^A-Z2-7]/g, ''))}
              placeholder="JBSWY3DPEHPK3PXP"
              mono
            />
          </Field>
          <InfoBox>A semente está no QR Code do serviço. Insira em Base32 (apenas A-Z e 2-7).</InfoBox>
        </Section>
      )}

      {/* Card */}
      {form.type === 'card' && (
        <Section label="Dados do cartão">
          <Field label="Titular">
            <Inp value={form.card.cardholder} onChange={v => setCard('cardholder', v)} placeholder="Nome como no cartão" />
          </Field>
          <Field label="Número">
            <Inp
              value={form.card.number}
              onChange={v => setCard('number', v.replace(/[^\d\s]/g, '').slice(0, 19))}
              placeholder="0000 0000 0000 0000"
              mono
            />
          </Field>
          <TwoCol>
            <Field label="Validade">
              <Inp
                value={form.card.expiry}
                onChange={v => setCard('expiry', v.replace(/[^\d/]/g, '').slice(0, 5))}
                placeholder="MM/AA"
                mono
              />
            </Field>
            <Field label="CVC">
              <Inp
                value={form.card.cvc}
                onChange={v => setCard('cvc', v.replace(/\D/g, '').slice(0, 4))}
                placeholder="123"
                mono
              />
            </Field>
          </TwoCol>
        </Section>
      )}

      {/* Note */}
      {form.type === 'note' && (
        <Section label="Conteúdo">
          <textarea
            value={form.note}
            onChange={e => set('note', e.target.value)}
            rows={8}
            placeholder="Escreva sua nota segura aqui..."
            style={{
              width: '100%', padding: '10px 12px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10, color: '#f0f0f0',
              fontFamily: tokens.typography.fontFamily, fontSize: '13px',
              outline: 'none', resize: 'vertical', lineHeight: 1.6,
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(79,152,163,0.45)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          />
        </Section>
      )}

      {/* Identity */}
      {form.type === 'identity' && (
        <Section label="Dados pessoais">
          <TwoCol>
            <Field label="Nome">
              <Inp value={form.identity.firstName} onChange={v => setIdentity('firstName', v)} placeholder="João" />
            </Field>
            <Field label="Sobrenome">
              <Inp value={form.identity.lastName} onChange={v => setIdentity('lastName', v)} placeholder="Silva" />
            </Field>
          </TwoCol>
          <Field label="Email">
            <Inp value={form.identity.email} onChange={v => setIdentity('email', v)} type="email" placeholder="joao@email.com" />
          </Field>
          <TwoCol>
            <Field label="Telefone">
              <Inp value={form.identity.phone} onChange={v => setIdentity('phone', v)} placeholder="+55 11 99999-9999" />
            </Field>
            <Field label="Documento">
              <Inp value={form.identity.document} onChange={v => setIdentity('document', v)} placeholder="CPF / RG..." />
            </Field>
          </TwoCol>
          <Field label="Endereço">
            <Inp value={form.identity.address} onChange={v => setIdentity('address', v)} placeholder="Rua, número, cidade" />
          </Field>
        </Section>
      )}

      {/* Passkey */}
      {form.type === 'passkey' && (
        <Section label="Passkey">
          <Field label="URL do site">
            <Inp value={form.url} onChange={v => set('url', v)} placeholder="https://..." />
          </Field>
          <Field label="Usuário">
            <Inp value={form.username} onChange={v => set('username', v)} placeholder="usuario@email.com" />
          </Field>
          <InfoBox>Passkeys são geradas automaticamente pelo dispositivo. Adicione aqui para referência.</InfoBox>
        </Section>
      )}

      {/* Tags */}
      <Section label="Organização">
        <Field label="Tags (separadas por vírgula)">
          <Inp value={form.tags} onChange={v => set('tags', v)} placeholder="trabalho, pessoal, banco..." />
        </Field>
      </Section>
    </div>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{
        fontFamily: tokens.typography.fontFamily, fontSize: '10px', fontWeight: 600,
        color: tokens.colors.neutral6, textTransform: 'uppercase', letterSpacing: '0.1em',
        marginBottom: 10,
      }}>
        {label}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontFamily: tokens.typography.fontFamily,
        fontSize: '11px', fontWeight: 500,
        color: 'rgba(255,255,255,0.5)', marginBottom: 5,
      }}>
        {label}{required && <span style={{ color: '#e87da0', marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '9px 12px', borderRadius: 8,
      background: 'rgba(79,152,163,0.06)', border: '1px solid rgba(79,152,163,0.15)',
      fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral7, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

function Inp({ value, onChange, placeholder, type = 'text', mono = false, autoFocus = false, style: extra }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type={type} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{
        width: '100%', padding: '9px 12px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 9, color: '#f0f0f0', outline: 'none',
        fontFamily: mono ? tokens.typography.fontFamilyMono : tokens.typography.fontFamily,
        fontSize: '13px', transition: 'border-color 0.15s, box-shadow 0.15s',
        ...extra,
      }}
      onFocus={e => { e.currentTarget.style.borderColor = 'rgba(79,152,163,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,152,163,0.08)'; }}
      onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
    />
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function SmallIconBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 26, height: 26, borderRadius: 6, border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'rgba(79,152,163,0.2)' : hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
        color: active ? '#4f98a3' : hov ? '#fff' : tokens.colors.neutral6,
        cursor: 'pointer', transition: 'all 0.13s', flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function FavoriteToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{
      background: 'none', border: 'none', cursor: 'pointer', padding: 2,
      fontSize: 18, color: on ? '#fdab43' : 'rgba(255,255,255,0.18)',
      transition: 'color 0.15s', lineHeight: 1,
    }}>
      {on ? '★' : '☆'}
    </button>
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
        background: hov ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: tokens.colors.neutral8, fontFamily: tokens.typography.fontFamily,
        fontSize: '13px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.13s',
      }}
    >
      {children}
    </button>
  );
}

function PrimaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: '9px 22px', borderRadius: 10, border: 'none',
        background: hov
          ? 'linear-gradient(135deg, #3d7a84, #4f98a3)'
          : 'linear-gradient(135deg, #4f98a3, #3d7a84)',
        color: '#fff', fontFamily: tokens.typography.fontFamily,
        fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
        boxShadow: hov ? '0 4px 16px rgba(79,152,163,0.4)' : '0 2px 8px rgba(79,152,163,0.25)',
      }}
    >
      {children}
    </button>
  );
}

// ─── TypeIcon ─────────────────────────────────────────────────────────────────

function TypeIcon({ type, size, color }: { type: VaultItemType; size: number; color: string }) {
  const s = { width: size, height: size, fill: 'none', stroke: color, strokeWidth: 1.7 };
  switch (type) {
    case 'password': return <svg viewBox="0 0 24 24" style={s}><rect x={3} y={11} width={18} height={11} rx={2}/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
    case 'card':     return <svg viewBox="0 0 24 24" style={s}><rect x={1} y={4} width={22} height={16} rx={2}/><line x1={1} y1={10} x2={23} y2={10}/></svg>;
    case 'note':     return <svg viewBox="0 0 24 24" style={s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>;
    case 'identity': return <svg viewBox="0 0 24 24" style={s}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx={12} cy={7} r={4}/></svg>;
    case 'totp':     return <svg viewBox="0 0 24 24" style={s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="12 8 12 12 14 14"/></svg>;
    case 'passkey':  return <svg viewBox="0 0 24 24" style={s}><circle cx={12} cy={8} r={4}/><path d="M12 12v8M9 18h6"/></svg>;
  }
}

function titlePlaceholder(type: VaultItemType): string {
  switch (type) {
    case 'password': return 'Ex: Gmail, GitHub, Banco...';
    case 'totp':     return 'Ex: Google Authenticator — Conta X';
    case 'card':     return 'Ex: Cartão Nubank, Visa Corporativo...';
    case 'note':     return 'Ex: Chave de API, Instruções...';
    case 'identity': return 'Ex: Meu Perfil, Dados CPF...';
    case 'passkey':  return 'Ex: Apple ID Passkey...';
  }
}
