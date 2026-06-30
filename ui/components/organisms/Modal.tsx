import React, { useEffect, useRef } from 'react';
import { useTheme } from '@ui/contexts/ThemeContext';
import type { BaseComponentProps } from '@shared/types';

type ModalProps = BaseComponentProps & {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const maxWidths: Record<string, string> = {
  sm: '420px',
  md: '580px',
  lg: '720px',
  xl: '960px',
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}) => {
  const { tokens, theme } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onClose]);

  // Trap focus inside panel
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
          background: isDark ? 'rgba(4,4,8,0.82)' : 'rgba(10,10,30,0.5)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: maxWidths[size],
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          background: isDark ? 'rgba(8,8,14,0.98)' : 'rgba(250,251,255,0.99)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)'}`,
          borderRadius: 18,
          boxShadow: isDark
            ? '0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(79,152,163,0.06), inset 0 1px 0 rgba(255,255,255,0.06)'
            : '0 20px 60px rgba(0,0,30,0.15), 0 0 0 1px rgba(79,152,163,0.1)',
          outline: 'none',
          overflow: 'hidden',
          animation: 'modal-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Gradient top line */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg, transparent 0%, rgba(79,152,163,0.5) 30%, rgba(155,125,232,0.4) 70%, transparent 100%)',
          borderRadius: '18px 18px 0 0',
        }} />

        {/* Header */}
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '18px 22px 16px',
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`,
            flexShrink: 0,
          }}>
            <h2 style={{
              fontFamily: tokens.typography.fontFamily,
              fontSize: '15px', fontWeight: 600, color: tokens.colors.neutral11, margin: 0,
            }}>
              {title}
            </h2>
            <button
              type="button" onClick={onClose} aria-label="Fechar"
              style={{
                width: 28, height: 28, borderRadius: 8,
                border: 'none', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                color: tokens.colors.neutral7, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.13s',
              }}
              onMouseEnter={e => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
                b.style.color = tokens.colors.neutral11;
              }}
              onMouseLeave={e => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
                b.style.color = tokens.colors.neutral7;
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '14px 22px',
            borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`,
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>

      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
};
