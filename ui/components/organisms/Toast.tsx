import React, { createContext, useContext, useState, useCallback } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { generateId } from '@shared/utils';
import type { ToastMessage } from '@shared/types';

interface ToastContextValue {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = generateId();
    const duration = toast.duration ?? 4000;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
};

const iconMap: Record<string, string> = {
  success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

const colorMap: Record<string, string> = {
  success: tokens.colors.success,
  error: tokens.colors.error,
  warning: tokens.colors.warning,
  info: tokens.colors.primary,
};

function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: tokens.zIndex.toast,
        maxWidth: '380px',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          onClick={() => removeToast(toast.id)}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px 16px',
            backgroundColor: tokens.colors.neutral2,
            borderRadius: tokens.radii.lg,
            border: `1px solid ${tokens.colors.neutral3}`,
            boxShadow: tokens.effects.shadowLg,
            cursor: 'pointer',
            animation: 'toast-enter 200ms ease',
          }}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colorMap[toast.type]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d={iconMap[toast.type]} />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: tokens.typography.fontFamily,
              fontSize: tokens.typography.sizes.sm,
              fontWeight: tokens.typography.weights.bold,
              color: tokens.colors.neutral12,
            }}>
              {toast.title}
            </div>
            {toast.description && (
              <div style={{
                fontFamily: tokens.typography.fontFamily,
                fontSize: tokens.typography.sizes.xs,
                color: tokens.colors.neutral8,
                marginTop: 2,
              }}>
                {toast.description}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
