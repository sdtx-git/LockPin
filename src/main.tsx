import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider, useToast } from '@ui/components/organisms';
import { ThemeProvider } from '@ui/contexts/ThemeContext';
import { LoginScreen } from '@apps/desktop/login';
import { VaultScreen } from '@apps/desktop/vault';
import { saveVault, vaultExists } from '@core/vault/storage';
import type { VaultData } from '@core/vault/types';
import { useAutoLock } from '@apps/desktop/hooks/useAutoLock';
import { wipeBuffer } from '@core/crypto/encryption';
import { AUTO_LOCK_TIMEOUT } from '@shared/constants';

function App() {
  const [masterPassword, setMasterPassword] = useState<string | null>(null);
  const [vault,          setVault]          = useState<VaultData | null>(null);
  const [vaultId,        setVaultId]        = useState<string | null>(null);
  const [hasVault,       setHasVault]       = useState(false);
  const passwordRef = useRef<string | null>(null);
  const extendRef = useRef(false);
  const { addToast } = useToast();

  useEffect(() => {
    vaultExists().then(setHasVault);
  }, []);

  const handleLock = useCallback(() => {
    if (passwordRef.current) {
      const buf = new TextEncoder().encode(passwordRef.current);
      wipeBuffer(buf);
    }
    passwordRef.current = null;
    setMasterPassword(null);
    setVault(null);
    setVaultId(null);
  }, []);

  const autoLockEnabled = masterPassword !== null;

  useAutoLock({
    timeout: AUTO_LOCK_TIMEOUT,
    onLock: handleLock,
    enabled: autoLockEnabled,
    onWarning: () => {
      if (extendRef.current) { extendRef.current = false; return; }
      addToast({
        type: 'warning',
        title: 'Bloqueio automático em 30s',
        description: 'Toque em qualquer tecla ou movimento do mouse para estender',
        duration: 8000,
      });
    },
  });

  const handleLoginSuccess = useCallback((password: string, vaultData: VaultData, id: string) => {
    passwordRef.current = password;
    setMasterPassword(password);
    setVault(vaultData);
    setVaultId(id);
    setHasVault(true);
  }, []);

  const handleVaultChange = useCallback(async (newVault: VaultData) => {
    setVault(newVault);
    if (masterPassword && vaultId) {
      await saveVault(newVault, masterPassword, vaultId);
    }
  }, [masterPassword, vaultId]);

  const handleLogout = useCallback(() => {
    if (passwordRef.current) {
      const buf = new TextEncoder().encode(passwordRef.current);
      wipeBuffer(buf);
    }
    passwordRef.current = null;
    setMasterPassword(null);
    setVault(null);
    setVaultId(null);
  }, []);

  if (!masterPassword || !vault) {
    return (
      <LoginScreen
        onLoginSuccess={handleLoginSuccess}
        hasExistingVault={hasVault}
      />
    );
  }

  return (
    <VaultScreen
      vault={vault}
      onVaultChange={handleVaultChange}
      masterPassword={masterPassword}
      onLogout={handleLogout}
    />
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <ThemeProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ThemeProvider>
);
