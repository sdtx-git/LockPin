import React, { useState } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { useToast, Modal } from '@ui/components/organisms';
import { saveVault, loadVault, setRecoveryKey, checkAuthMode, saveAuthInfo, deleteAuthInfo, deleteVaultData, getDpapiMasterKey, findVaultByRecoveryWords } from '@core/vault/storage';
import { invoke } from '@tauri-apps/api/core';
import { APP_NAME, APP_VERSION, PASSWORD_MIN_LENGTH, MAX_LOGIN_ATTEMPTS, LOGIN_LOCKOUT_SECONDS } from '@shared/constants';
import type { VaultData } from '@core/vault/types';

interface LoginScreenProps {
  onLoginSuccess: (masterPassword: string, vaultData: VaultData, vaultId: string) => void;
  hasExistingVault: boolean;
}

type Mode = 'login' | 'register';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, hasExistingVault }) => {
  const [mode, setMode]               = useState<Mode>(hasExistingVault ? 'login' : 'register');
  const [password, setPassword]       = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [showPassword, setShowPwd]    = useState(false);
  const [showConfirm, setShowCfm]     = useState(false);
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [loading, setLoading]         = useState(false);
  const [attempts, setAttempts]       = useState(0);
  const [lockoutUntil, setLockout]    = useState<number | null>(null);
  const [helloAvailable, setHelloAvailable] = useState(false);
  const { addToast } = useToast();

  React.useEffect(() => {
    invoke<boolean>('windows_hello_available').then(setHelloAvailable).catch(() => {});
  }, []);

  const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil;
  const lockoutRemaining = lockoutUntil ? Math.ceil((lockoutUntil - Date.now()) / 1000) : 0;
  const isRegister = mode === 'register';

  const switchMode = (next: Mode) => {
    setMode(next); setPassword(''); setConfirm(''); setErrors({});
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!password) {
      e.password = 'Senha obrigatória';
    } else if (isRegister && password.length < PASSWORD_MIN_LENGTH) {
      e.password = `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`;
    }
    if (isRegister && confirmPassword !== password) e.confirm = 'As senhas não coincidem';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (isLockedOut || !validate()) return;
    setLoading(true);
    try {
      if (isRegister) {
        const { mode: existingMode } = await checkAuthMode(password);
        if (existingMode !== 'invalid') {
          addToast({ type: 'error', title: 'Senha já existe', description: 'Esta senha já está em uso em outro vault.' });
          return;
        }
        const vaultId = crypto.randomUUID();
        const emptyVault: VaultData = { items: [], collections: [], organizations: [], auditLogs: [], folders: [], trash: [], version: 1 };
        await saveVault(emptyVault, password, vaultId);
        const { vault: vaultWithKey, words } = await setRecoveryKey(emptyVault, password, 'Vault recovery key');
        await saveVault(vaultWithKey, password, vaultId);
        const dpapiBlob = await invoke<string>('dpapi_protect', { data: [...new TextEncoder().encode(password)] }).catch(() => '');
        if (dpapiBlob) localStorage.setItem('lockpin-hello-vaultid', vaultId);
        await saveAuthInfo(vaultId, password, duressPassword || undefined, killPassword || undefined, dpapiBlob || undefined, vaultWithKey.recoveryKey?.encryptedMasterKey);
        addToast({ type: 'success', title: 'Vault criado!', description: 'Suas credenciais estão protegidas localmente.' });
        showRecoveryDialog(words);
        onLoginSuccess(password, vaultWithKey, vaultId);
      } else {
        const { mode: authMode, vaultId } = await checkAuthMode(password);
        if (authMode === 'kill' && vaultId) {
          await deleteVaultData(vaultId);
          await deleteAuthInfo(vaultId);
          addToast({ type: 'warning', title: 'Vault destruído', description: 'Kill switch ativado.' });
          switchMode('register');
          return;
        }
        if (authMode === 'duress' && vaultId) {
          const decoy: VaultData = { items: [], collections: [], organizations: [], auditLogs: [], folders: [], trash: [], version: 1 };
          addToast({ type: 'info', title: 'Modo duress', description: 'Vault alternativo aberto.' });
          onLoginSuccess(password, decoy, vaultId);
          return;
        }
        if (authMode === 'invalid') {
          const next = attempts + 1;
          setAttempts(next);
          if (next >= MAX_LOGIN_ATTEMPTS) {
            const until = Date.now() + LOGIN_LOCKOUT_SECONDS * 1000;
            setLockout(until);
            setTimeout(() => { setLockout(null); setAttempts(0); }, LOGIN_LOCKOUT_SECONDS * 1000);
            addToast({ type: 'error', title: 'Bloqueado', description: `Aguarde ${LOGIN_LOCKOUT_SECONDS}s` });
          } else {
            addToast({ type: 'error', title: 'Senha incorreta', description: `${MAX_LOGIN_ATTEMPTS - next} tentativas restantes` });
          }
          return;
        }
        if (!vaultId) {
          addToast({ type: 'error', title: 'Vault não encontrado', description: 'Crie um vault primeiro.' });
          switchMode('register');
          return;
        }
        const vault = await loadVault(password, vaultId);
        if (!vault) {
          addToast({ type: 'error', title: 'Vault não encontrado', description: 'Crie um vault primeiro.' });
          switchMode('register');
          return;
        }
        addToast({ type: 'success', title: 'Vault desbloqueado!' });
        onLoginSuccess(password, vault, vaultId);
      }
    } catch {
      addToast({ type: 'error', title: 'Erro inesperado', description: 'Tente novamente.' });
    } finally {
      setLoading(false);
    }
  };

  const handleWindowsHello = async () => {
    try {
      const ok = await invoke<boolean>('windows_hello_auth', { prompt: 'Desbloquear LockPin' });
      if (!ok) { addToast({ type: 'error', title: 'Autenticação falhou' }); return; }
      const helloVaultId = localStorage.getItem('lockpin-hello-vaultid');
      if (!helloVaultId) { addToast({ type: 'error', title: 'Nenhum vault vinculado ao Windows Hello' }); return; }
      const dpapiKey = await getDpapiMasterKey(helloVaultId);
      if (!dpapiKey) { addToast({ type: 'error', title: 'Nenhum vault vinculado ao Windows Hello' }); return; }
      const protectedBytes = Uint8Array.from(atob(dpapiKey), c => c.charCodeAt(0));
      const decrypted = await invoke<number[]>('dpapi_unprotect', { data: [...protectedBytes] });
      const masterPwd = new TextDecoder().decode(new Uint8Array(decrypted));
      const vault = await loadVault(masterPwd, helloVaultId);
      if (!vault) { addToast({ type: 'error', title: 'Vault não encontrado' }); return; }
      addToast({ type: 'success', title: 'Vault desbloqueado com Windows Hello!' });
      onLoginSuccess(masterPwd, vault, helloVaultId);
    } catch {
      addToast({ type: 'error', title: 'Windows Hello indisponível' });
    }
  };

  const showRecoveryDialog = (words: string) => {
    setShowRecovery(true);
    setRecoveryWords(words);
  };

  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryWords, setRecoveryWords] = useState('');
  const [duressPassword, setDuressPassword] = useState('');
  const [killPassword, setKillPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleRecover = async () => {
    try {
      const result = await findVaultByRecoveryWords(recoveryInput);
      if (!result) { addToast({ type: 'error', title: 'Frase inválida', description: 'Nenhum vault encontrado com essa frase.' }); return; }
      onLoginSuccess(result.masterPassword, result.vault, result.vaultId);
      setShowRecovery(false);
    } catch {
      addToast({ type: 'error', title: 'Recuperação falhou' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, position: 'relative', overflow: 'hidden', background: '#060608',
    }}>
      {/* Ambient glows */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: '60%', height: '60%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,152,163,0.07) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-20%', right: '-10%', width: '60%', height: '60%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(155,125,232,0.06) 0%, transparent 70%)' }} />
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 400, padding: '44px 36px',
        background: 'rgba(10,10,15,0.92)', backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20,
        boxShadow: '0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(79,152,163,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
        position: 'relative', zIndex: 1,
      }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 60, height: 60, borderRadius: 18, margin: '0 auto 18px',
            background: 'linear-gradient(135deg, rgba(79,152,163,0.2), rgba(155,125,232,0.15))',
            border: '1px solid rgba(79,152,163,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 24px rgba(79,152,163,0.15)',
          }}>
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="url(#lg)" strokeWidth={1.7}>
              <defs>
                <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4f98a3" />
                  <stop offset="100%" stopColor="#9b7de8" />
                </linearGradient>
              </defs>
              <rect x={3} y={11} width={18} height={11} rx={2} />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <div style={{
            fontFamily: tokens.typography.fontFamily, fontSize: '24px', fontWeight: 800, letterSpacing: '0.07em',
            background: 'linear-gradient(135deg, #4f98a3 0%, #9b7de8 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 7,
          }}>
            LOCKPIN
          </div>
          <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral6, lineHeight: 1.5 }}>
            {isRegister ? 'Defina sua senha mestra para criar o vault' : 'Digite sua senha mestra para desbloquear'}
          </div>
        </div>

        {/* Mode tab */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, marginBottom: 24, border: '1px solid rgba(255,255,255,0.06)' }}>
          {(['login', 'register'] as Mode[]).map(m => (
            <button key={m} onClick={() => switchMode(m)} style={{
              flex: 1, padding: '8px 0', border: 'none', borderRadius: 8,
              fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.18s',
              background: mode === m ? 'rgba(79,152,163,0.18)' : 'transparent',
              color: mode === m ? '#4f98a3' : tokens.colors.neutral6,
              boxShadow: mode === m ? 'inset 0 0 0 1px rgba(79,152,163,0.25)' : 'none',
            }}>
              {m === 'login' ? 'Entrar' : 'Criar Vault'}
            </button>
          ))}
        </div>

        {/* Multi-vault notice */}
        {isRegister && hasExistingVault && (
          <div style={{ padding: '10px 14px', marginBottom: 18, background: 'rgba(79,152,163,0.07)', border: '1px solid rgba(79,152,163,0.22)', borderRadius: 10, display: 'flex', gap: 10 }}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>ℹ️</span>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: '#4f98a3', lineHeight: 1.5, margin: 0 }}>
              Um novo vault independente será criado com esta senha. Cada senha acessa seu próprio vault.
            </p>
          </div>
        )}

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FieldGroup label="Senha Mestra" error={errors.password}>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'} value={password}
                onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: '' })); }}
                onKeyDown={handleKeyDown}
                placeholder={isRegister ? `Mínimo ${PASSWORD_MIN_LENGTH} caracteres` : 'Digite sua senha mestra'}
                disabled={loading || isLockedOut} autoFocus
                style={{ ...inputStyle(!!errors.password), paddingRight: 44 }}
              />
              <EyeToggle show={showPassword} onToggle={() => setShowPwd(v => !v)} />
            </div>
          </FieldGroup>

          {isRegister && (
            <FieldGroup label="Confirmar Senha" error={errors.confirm}>
              <div style={{ position: 'relative' }}>
                <input
                  type={showConfirm ? 'text' : 'password'} value={confirmPassword}
                  onChange={e => { setConfirm(e.target.value); setErrors(p => ({ ...p, confirm: '' })); }}
                  onKeyDown={handleKeyDown} placeholder="Repita a senha mestra"
                  disabled={loading || isLockedOut}
                  style={{ ...inputStyle(!!errors.confirm), paddingRight: 44 }}
                />
                <EyeToggle show={showConfirm} onToggle={() => setShowCfm(v => !v)} />
              </div>
            </FieldGroup>
          )}

          {isRegister && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => setShowAdvanced(v => !v)} style={{
                background: 'none', border: 'none', color: tokens.colors.neutral6, cursor: 'pointer',
                fontFamily: tokens.typography.fontFamily, fontSize: '12px', textAlign: 'left',
                padding: '6px 0', textDecoration: 'underline', textUnderlineOffset: 3,
              }}>
                {showAdvanced ? '−' : '+'} Opções avançadas
              </button>
              {showAdvanced && (
                <>
                  <FieldGroup label="Senha duress (opcional)" error={errors.duress}>
                    <input type="text" value={duressPassword} onChange={e => setDuressPassword(e.target.value)} placeholder="Senha que abre vault vazio" disabled={loading || isLockedOut}
                      style={{ ...inputStyle(false), padding: '9px 12px', fontSize: '13px' }} />
                  </FieldGroup>
                  <FieldGroup label="Kill switch (opcional)" error={errors.kill}>
                    <input type="text" value={killPassword} onChange={e => setKillPassword(e.target.value)} placeholder="Senha que destrói o vault" disabled={loading || isLockedOut}
                      style={{ ...inputStyle(false), padding: '9px 12px', fontSize: '13px' }} />
                  </FieldGroup>
                </>
              )}
            </div>
          )}

          {isLockedOut && (
            <div style={{ padding: '10px 14px', background: 'rgba(209,99,167,0.08)', border: '1px solid rgba(209,99,167,0.2)', borderRadius: 10, fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: '#e87da0' }}>
              Muitas tentativas — aguarde {lockoutRemaining}s
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading || isLockedOut} style={{
            width: '100%', padding: '13px', marginTop: 4,
            background: loading || isLockedOut
              ? 'rgba(79,152,163,0.25)'
              : 'linear-gradient(135deg, #4f98a3 0%, #3a7280 100%)',
            border: 'none', borderRadius: 12, color: '#fff',
            fontFamily: tokens.typography.fontFamily, fontSize: '14px', fontWeight: 600,
            cursor: loading || isLockedOut ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: loading || isLockedOut ? 'none' : '0 6px 20px rgba(79,152,163,0.35)',
          }}>
            {loading ? (
              <>
                <svg style={{ animation: 'spin 0.8s linear infinite' }} width={16} height={16} viewBox="0 0 24 24">
                  <circle cx={12} cy={12} r={10} stroke="currentColor" strokeWidth={3} fill="none" opacity={0.25} />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={3} fill="none" />
                </svg>
                {isRegister ? 'Criando vault...' : 'Desbloqueando...'}
              </>
            ) : (
              isRegister ? 'Criar Vault Local' : 'Desbloquear Vault'
            )}
          </button>

          {!isRegister && helloAvailable && (
            <button onClick={handleWindowsHello} style={{
              width: '100%', padding: '11px', borderRadius: 12,
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#f0f0f0', fontFamily: tokens.typography.fontFamily, fontSize: '13px',
              fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 10, transition: 'all 0.15s',
            }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <rect x={3} y={11} width={18} height={11} rx={2} />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Entrar com Windows Hello
            </button>
          )}

          {!isRegister && (
            <button onClick={() => setShowRecovery(true)} style={{
              background: 'none', border: 'none', color: tokens.colors.neutral6,
              fontFamily: tokens.typography.fontFamily, fontSize: '12px',
              cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3,
              padding: 0,
            }}>
              Esqueceu a senha? Recuperar vault
            </button>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 30, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          {['AES-256-GCM', 'PBKDF2', 'Zero-Knowledge', 'Local', 'Auto-Lock'].map(tag => (
            <span key={tag} style={{
              fontFamily: tokens.typography.fontFamilyMono, fontSize: '10px',
              color: tokens.colors.neutral6, background: 'rgba(255,255,255,0.04)',
              padding: '3px 9px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {tag}
            </span>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral5 }}>
          {APP_NAME} · v{APP_VERSION}
        </div>
      </div>

      {/* Recovery Dialog */}
      <Modal
        open={showRecovery}
        onClose={() => setShowRecovery(false)}
        title={recoveryWords ? 'Chave de Recuperação' : 'Recuperar Vault'}
      >
        {recoveryWords ? (
          <div style={{ padding: '0 0 16px' }}>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral8, marginBottom: 12 }}>
              Anote estas palavras em local seguro. Elas podem recuperar seu vault.
            </p>
            <div style={{
              padding: '16px', background: 'rgba(79,152,163,0.06)',
              border: '1px solid rgba(79,152,163,0.2)', borderRadius: 12,
              fontFamily: tokens.typography.fontFamilyMono, fontSize: '14px',
              color: tokens.colors.neutral11, lineHeight: 1.8, userSelect: 'all',
            }}>
              {recoveryWords.split(' ').map((w, i) => (
                <span key={i} style={{ display: 'inline-block', margin: '2px 4px', padding: '2px 8px', background: 'rgba(79,152,163,0.08)', borderRadius: 6 }}>
                  {i + 1}. {w}
                </span>
              ))}
            </div>
            <button onClick={() => setShowRecovery(false)} style={{ marginTop: 16, padding: '9px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #4f98a3, #3d7a84)', color: '#fff', fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Anotei, continuar</button>
          </div>
        ) : (
          <div style={{ padding: '0 0 16px' }}>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral8, marginBottom: 12 }}>
              Digite a frase de recuperação (12 palavras) para restaurar seu vault.
            </p>
            <input
              type="text"
              value={recoveryInput}
              onChange={e => setRecoveryInput(e.target.value)}
              placeholder="ex: abacate banana cacto dedo..."
              style={{
                width: '100%', padding: '11px 14px', marginBottom: 12,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10, color: '#f0f0f0', fontFamily: tokens.typography.fontFamilyMono,
                fontSize: '13px', outline: 'none',
              }}
            />
            <button onClick={handleRecover} style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #4f98a3, #3d7a80)', color: '#fff', fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Recuperar Vault</button>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '11px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${hasError ? 'rgba(209,99,167,0.5)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: 10, color: '#f0f0f0',
    fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
    fontSize: '14px', outline: 'none', transition: 'border-color 0.15s',
  };
}

function FieldGroup({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
        fontSize: '12px', fontWeight: 500, marginBottom: 7,
        color: error ? '#e87da0' : 'rgba(255,255,255,0.5)',
      }}>
        {label}
      </label>
      {children}
      {error && <p style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif', fontSize: '11px', color: '#e87da0', marginTop: 5 }}>{error}</p>}
    </div>
  );
}

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={{
      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
      background: 'none', border: 'none', cursor: 'pointer',
      color: tokens.colors.neutral6, padding: 2, display: 'flex',
    }} aria-label={show ? 'Ocultar' : 'Mostrar'}>
      {show
        ? <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
        : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
      }
    </button>
  );
}
