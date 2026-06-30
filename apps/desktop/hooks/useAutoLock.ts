import { useEffect, useRef, useCallback } from 'react';

interface UseAutoLockOptions {
  timeout: number;
  onLock: () => void;
  onWarning?: () => void;
  enabled?: boolean;
}

const WARN_BEFORE = 30_000;

export function useAutoLock({ timeout, onLock, onWarning, enabled = true }: UseAutoLockOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLockRef = useRef(onLock);
  const onWarnRef = useRef(onWarning);
  onLockRef.current = onLock;
  onWarnRef.current = onWarning;

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warnRef.current) clearTimeout(warnRef.current);
    timerRef.current = setTimeout(() => {
      onLockRef.current();
    }, timeout);
    if (onWarnRef.current && timeout > WARN_BEFORE) {
      warnRef.current = setTimeout(() => {
        onWarnRef.current!();
      }, timeout - WARN_BEFORE);
    }
  }, [timeout, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const events = ['mousedown', 'keydown', 'mousemove', 'touchstart', 'scroll', 'wheel'];
    events.forEach(ev => window.addEventListener(ev, resetTimer));
    resetTimer();
    return () => {
      events.forEach(ev => window.removeEventListener(ev, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warnRef.current) clearTimeout(warnRef.current);
    };
  }, [resetTimer, enabled]);

  return { resetTimer };
}
