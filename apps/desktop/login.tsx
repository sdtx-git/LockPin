import React, { useState } from 'react';
import { Button, Logo, TitleBar } from '@ui/components/atoms';
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
  const helloLinked = !!localStorage.getItem('lockpin-hello-vaultid');
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
          await invoke('attachments_wipe_if_no_vaults');
          addToast({ type: 'warning', title: 'Vault destruído', description: 'Kill switch ativado.' });
          switchMode('register');
          return;
        }
        if (authMode === 'duress' && vaultId) {
          const decoyId = `decoy-${vaultId}`;
          const decoy: VaultData = (await loadVault(password, decoyId))
            ?? { items: [], collections: [], organizations: [], auditLogs: [], folders: [], trash: [], version: 1 };
          addToast({ type: 'success', title: 'Vault desbloqueado!' });
          onLoginSuccess(password, decoy, decoyId);
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
    <div className="auth">
      <TitleBar floating />
      <aside className="auth__brand">
        <div className="auth__brand-row">
          <Logo size={34} />
          <span>LockPin</span>
        </div>
        <div>
          <h2 className="auth__headline">Seu cofre,<br />em qualquer lugar.</h2>
          <p className="auth__lead">Senhas, cartões e notas cifrados no seu dispositivo. Sem conta, sem servidor e sem nuvem.</p>
          <ul className="auth__facts">
            <li>
              <span className="auth__fact-icon"><svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x={4} y={10} width={16} height={11} rx={2} /><path d="M8 10V7a4 4 0 018 0v3" /></svg></span>
              <div><strong>AES-256-GCM</strong><span>O vault é cifrado com a sua senha mestra.</span></div>
            </li>
            <li>
              <span className="auth__fact-icon"><svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg></span>
              <div><strong>Argon2id</strong><span>Derivação de chave resistente a força bruta.</span></div>
            </li>
            <li>
              <span className="auth__fact-icon"><svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x={7} y={2} width={10} height={9} rx={1} /><rect x={5} y={11} width={14} height={11} rx={2} /><path d="M10 5h1M13 5h1" /></svg></span>
              <div><strong>Portátil</strong><span>Windows e Linux usando o mesmo vault.</span></div>
            </li>
          </ul>
        </div>
        <span className="auth__version">{APP_NAME} {APP_VERSION}</span>
      </aside>

      <main className="auth__main">
      <div className="auth__panel">
        <div className="auth__compact-brand">
          <Logo size={32} />
          <span>LockPin</span>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2, color: 'var(--text)' }}>
          {isRegister ? 'Criar um vault' : 'Bem-vindo de volta'}
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-3)', marginTop: 6, marginBottom: 24 }}>
          {isRegister ? 'Defina a senha mestra. Ela não pode ser redefinida sem a frase de recuperação.' : 'Digite sua senha mestra para desbloquear o vault.'}
        </p>

        <div className="card auth__card">
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

            {!isRegister && helloAvailable && helloLinked && (
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
          <span className="auth__compact-version">{APP_NAME} {APP_VERSION}</span>
        </div>

        <p className="auth__compact-note">
          Seus dados ficam cifrados neste dispositivo com AES-256-GCM. Não há conta, servidor nem sincronização.
        </p>
      </div>
      </main>

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
