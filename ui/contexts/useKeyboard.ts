import { useEffect, useRef } from 'react';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  handler: () => void;
  enabled?: boolean;
}

export function useKeyboard(shortcuts: Shortcut[]) {
  // ref evita re-registrar o listener a cada render
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const s of ref.current) {
        if (s.enabled === false || e.defaultPrevented) continue;
        const matchCtrl = s.ctrl ? e.ctrlKey || e.metaKey : !(e.ctrlKey || e.metaKey);
        if (matchCtrl && e.key.toLowerCase() === s.key.toLowerCase() && !e.repeat) {
          e.preventDefault();
          s.handler();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
