import React, { useState } from 'react';
import { Button, Logo } from '@ui/components/atoms';
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
        // só entra no vault depois que a frase for exibida
        pendingLogin.current = () => onLoginSuccess(password, vaultWithKey, vaultId);
        showRecoveryDialog(words);
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

  const pendingLogin = React.useRef<(() => void) | null>(null);

  const closeRecovery = () => {
    setShowRecovery(false);
    pendingLogin.current?.();
    pendingLogin.current = null;
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
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--canvas)', overflowY: 'auto',
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Marca */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <Logo size={32} />
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)' }}>LockPin</span>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25, color: 'var(--text)' }}>
          {isRegister ? 'Criar um vault' : 'Desbloquear o vault'}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6, marginBottom: 22 }}>
          {isRegister ? 'Defina a senha mestra. Ela não pode ser redefinida sem a frase de recuperação.' : 'Digite sua senha mestra para continuar.'}
        </p>

        <div className="card" style={{ padding: 20 }}>
          <div className="segmented" style={{ marginBottom: 18 }}>
            {(['login', 'register'] as Mode[]).map(m => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)}>
                {m === 'login' ? 'Entrar' : 'Criar vault'}
              </button>
            ))}
          </div>

          {isRegister && hasExistingVault && (
            <p className="note" style={{ marginBottom: 16 }}>
              Um novo vault independente será criado. Cada senha mestra abre o seu próprio vault.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FieldGroup label="Senha mestra" error={errors.password}>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'} value={password}
                  onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: '' })); }}
                  onKeyDown={handleKeyDown}
                  placeholder={isRegister ? `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres` : ''}
                  disabled={loading || isLockedOut} autoFocus
                  className={`input${errors.password ? ' input--error' : ''}`}
                  style={{ paddingRight: 40 }}
                />
                <EyeToggle show={showPassword} onToggle={() => setShowPwd(v => !v)} />
              </div>
            </FieldGroup>

            {isRegister && (
              <FieldGroup label="Confirmar senha mestra" error={errors.confirm}>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showConfirm ? 'text' : 'password'} value={confirmPassword}
                    onChange={e => { setConfirm(e.target.value); setErrors(p => ({ ...p, confirm: '' })); }}
                    onKeyDown={handleKeyDown}
                    disabled={loading || isLockedOut}
                    className={`input${errors.confirm ? ' input--error' : ''}`}
                    style={{ paddingRight: 40 }}
                  />
                  <EyeToggle show={showConfirm} onToggle={() => setShowCfm(v => !v)} />
                </div>
              </FieldGroup>
            )}

            {isRegister && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} aria-expanded={showAdvanced} onClick={() => setShowAdvanced(v => !v)}>
                  {showAdvanced ? 'Ocultar opções avançadas' : 'Opções avançadas'}
                </button>
                {showAdvanced && (
                  <>
                    <FieldGroup label="Senha de coação (opcional)" hint="Abre um vault vazio no lugar do verdadeiro." error={errors.duress}>
                      <input type="text" value={duressPassword} onChange={e => setDuressPassword(e.target.value)} disabled={loading || isLockedOut} className="input" />
                    </FieldGroup>
                    <FieldGroup label="Senha de destruição (opcional)" hint="Apaga o vault ao ser digitada no login." error={errors.kill}>
                      <input type="text" value={killPassword} onChange={e => setKillPassword(e.target.value)} disabled={loading || isLockedOut} className="input" />
                    </FieldGroup>
                  </>
                )}
              </div>
            )}

            {isLockedOut && (
              <p className="note note--danger">Muitas tentativas. Aguarde {lockoutRemaining}s para tentar de novo.</p>
            )}

            <Button size="lg" fullWidth onClick={handleSubmit} disabled={isLockedOut} loading={loading}>
              {loading
                ? (isRegister ? 'Criando vault…' : 'Desbloqueando…')
                : (isRegister ? 'Criar vault' : 'Desbloquear')}
            </Button>

            {!isRegister && helloAvailable && (
              <Button variant="secondary" size="lg" fullWidth onClick={handleWindowsHello}>
                Entrar com Windows Hello
              </Button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 12 }}>
          {!isRegister
            ? <button type="button" className="link-btn" onClick={() => setShowRecovery(true)}>Esqueci a senha mestra</button>
            : <span />}
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{APP_NAME} {APP_VERSION}</span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 28, lineHeight: 1.55 }}>
          Seus dados ficam só neste computador, cifrados com AES-256-GCM. Não há conta, servidor nem sincronização.
        </p>
      </div>

      {/* Recuperação */}
      <Modal
        open={showRecovery}
        onClose={closeRecovery}
        title={recoveryWords ? 'Frase de recuperação' : 'Recuperar vault'}
        size="sm"
      >
        {recoveryWords ? (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              Anote estas 12 palavras, na ordem, e guarde fora do computador. Elas são a única forma de recuperar o vault sem a senha mestra.
            </p>
            <ol className="mono" style={{
              listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
              fontSize: 13, color: 'var(--text)', userSelect: 'all',
            }}>
              {recoveryWords.split(' ').map((w, i) => (
                <li key={i} style={{ padding: '7px 9px', background: 'var(--fill)', borderRadius: 5, display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--text-4)', minWidth: 16, textAlign: 'right' }}>{i + 1}</span>{w}
                </li>
              ))}
            </ol>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={closeRecovery}>Anotei a frase</Button>
            </div>
          </div>
        ) : (
          <div>
            <FieldGroup label="Frase de recuperação" hint="As 12 palavras, separadas por espaço.">
              <input
                type="text" value={recoveryInput} autoFocus
                onChange={e => setRecoveryInput(e.target.value)}
                className="input mono"
              />
            </FieldGroup>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" onClick={() => setShowRecovery(false)}>Cancelar</Button>
              <Button onClick={handleRecover} disabled={!recoveryInput.trim()}>Recuperar vault</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FieldGroup({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {hint && !error && <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 5 }}>{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="icon-btn" style={{ position: 'absolute', right: 5, top: 5 }}
      aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
      {show
        ? <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" /></svg>
        : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx={12} cy={12} r={3} /></svg>
      }
    </button>
  );
}
