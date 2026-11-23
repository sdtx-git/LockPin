import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const isDesktop = !/Android|iPhone|iPad/i.test(navigator.userAgent);

export const TitleBar: React.FC<{ floating?: boolean }> = ({ floating = false }) => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    const win = getCurrentWindow();
    const sync = () => { win.isMaximized().then(setMaximized).catch(() => {}); };
    sync();
    const off = win.onResized(sync);
    return () => { off.then(fn => fn()).catch(() => {}); };
  }, []);

  if (!isDesktop) return null;

  const win = () => getCurrentWindow();

  return (
    <div className={`titlebar${floating ? ' titlebar--floating' : ''}`} data-tauri-drag-region>
      <div className="titlebar__controls">
        <button type="button" className="titlebar__btn" aria-label="Minimizar" title="Minimizar" onClick={() => win().minimize()}>
          <svg width={10} height={10} viewBox="0 0 10 10"><line x1={1} y1={5} x2={9} y2={5} stroke="currentColor" strokeWidth={1.1} /></svg>
        </button>
        <button type="button" className="titlebar__btn" aria-label={maximized ? 'Restaurar' : 'Maximizar'} title={maximized ? 'Restaurar' : 'Maximizar'} onClick={() => win().toggleMaximize()}>
          {maximized
            ? <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.1}><rect x={1} y={3} width={6} height={6} rx={1} /><path d="M3 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7" /></svg>
            : <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.1}><rect x={1.5} y={1.5} width={7} height={7} rx={1} /></svg>}
        </button>
        <button type="button" className="titlebar__btn titlebar__btn--close" aria-label="Fechar" title="Fechar" onClick={() => win().close()}>
          <svg width={10} height={10} viewBox="0 0 10 10" stroke="currentColor" strokeWidth={1.1}><line x1={1.5} y1={1.5} x2={8.5} y2={8.5} /><line x1={8.5} y1={1.5} x2={1.5} y2={8.5} /></svg>
        </button>
      </div>
    </div>
  );
};
