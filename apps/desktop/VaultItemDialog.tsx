import React, { useState, useEffect, useCallback } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { Button } from '@ui/components/atoms';
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

const TYPES: { key: VaultItemType; label: string }[] = [
  { key: 'password', label: 'Senha' },
  { key: 'totp',     label: 'Autenticador' },
  { key: 'card',     label: 'Cartão' },
  { key: 'note',     label: 'Nota' },
  { key: 'identity', label: 'Identidade' },
  { key: 'passkey',  label: 'Passkey' },
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

  return (
    <div
      role="dialog" aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: tokens.zIndex.modal,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--overlay)' }} />

      <div
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: 560,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
          animation: 'modal-in 0.16s ease-out',
        }}
        onKeyDown={handleKey}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
            {isEdit ? `Editar "${editingItem.title}"` : 'Novo item'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="icon-btn">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Type picker */}
        <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
          <div className="segmented" role="group" aria-label="Tipo de item">
            {TYPES.map(t => (
              <button key={t.key} type="button" aria-pressed={form.type === t.key} onClick={() => set('type', t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
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

        {error && (
          <div style={{ padding: '0 20px 10px' }}>
            <p className="note note--danger">{error}</p>
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0,
        }}>
          <FavoriteToggle on={form.favorite} onChange={v => set('favorite', v)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={onSave}>{isEdit ? 'Salvar alterações' : 'Salvar item'}</Button>
          </div>
        </div>
      </div>
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
                style={{ paddingRight: 72 }}
              />
              <div style={{ position: 'absolute', right: 5, top: 5, display: 'flex', gap: 2 }}>
                <SmallIconBtn label={showPassword ? 'Ocultar' : 'Mostrar'} onClick={onTogglePassword}>
                  {showPassword
                    ? <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>
                    : <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx={12} cy={12} r={3}/></svg>
                  }
                </SmallIconBtn>
                <SmallIconBtn
                  label="Gerar senha"
                  onClick={onToggleGenerator}
                  active={showGenerator}
                >
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                </SmallIconBtn>
              </div>
            </div>

            {/* Strength */}
            {form.password && strength && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 3, background: 'var(--fill-hover)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: { weak: '25%', fair: '50%', strong: '75%', maximum: '100%' }[strength],
                    background: strengthColor(strength),
                    borderRadius: 2, transition: 'width 0.3s, background 0.3s',
                  }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>
                  {strengthLabel(strength)}
                </span>
              </div>
            )}
          </Field>

          {/* Inline generator */}
          {showGenerator && (
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
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
                        className="input"
            style={{ lineHeight: 1.6 }}
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
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>{label}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label">
        {label}{required && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> (obrigatório)</span>}
      </label>
      {children}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return <div className="note">{children}</div>;
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
      className={mono ? 'input mono' : 'input'}
      style={extra}
    />
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function SmallIconBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="icon-btn"
      style={active ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}>
      {children}
    </button>
  );
}

function FavoriteToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="star" aria-pressed={on} onClick={() => onChange(!on)}
      style={{ alignItems: 'center', gap: 8, fontSize: 13 }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      <span style={{ color: 'var(--text-2)' }}>Favorito</span>
    </button>
  );
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
