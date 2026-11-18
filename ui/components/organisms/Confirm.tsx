import React, { useCallback, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from '@ui/components/atoms';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

// Confirmação para ações irreversíveis: const [confirm, dialog] = useConfirm()
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const close = (v: boolean) => { resolver.current?.(v); setOpts(null); };

  const dialog = (
    <Modal open={!!opts} onClose={() => close(false)} title={opts?.title} size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => close(false)}>Cancelar</Button>
        <Button variant="danger" onClick={() => close(true)}>{opts?.confirmLabel}</Button>
      </>}
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>{opts?.message}</p>
    </Modal>
  );

  return [confirm, dialog];
}
