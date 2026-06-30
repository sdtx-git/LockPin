import { useEffect } from 'react';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  handler: () => void;
  enabled?: boolean;
}

export function useKeyboard(shortcuts: Shortcut[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const s of shortcuts) {
        if (s.enabled === false) continue;
        const matchCtrl = s.ctrl ? e.ctrlKey || e.metaKey : true;
        if (matchCtrl && e.key === s.key && !e.repeat) {
          e.preventDefault();
          s.handler();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);
}
