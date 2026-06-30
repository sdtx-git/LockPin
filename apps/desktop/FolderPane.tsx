import React, { useState, useRef, useCallback } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { useToast } from '@ui/components/organisms';
import { generateId } from '@shared/utils';
import {
  encryptVault, decryptVault,
  serializeVault, deserializeVault,
} from '@core/crypto/encryption';
import type { VaultFolder, VaultFile } from '@core/vault/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file
const MIN_FOLDER_PWD = 6;

const FOLDER_COLORS = [
  '#4f98a3', '#9b7de8', '#fdab43', '#e87da0', '#6daa45', '#63b3ff',
];

// ── In-memory unlock state (never persisted) ──────────────────────────────────

interface UnlockedState {
  password: string;
  files: VaultFile[];
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface FolderPaneProps {
  folders: VaultFolder[];
  onChange: (folders: VaultFolder[]) => void;
}

// ── FolderPane ────────────────────────────────────────────────────────────────

export const FolderPane: React.FC<FolderPaneProps> = ({ folders, onChange }) => {
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId]     = useState<string | null>(null);
  const [unlocked, setUnlocked]                 = useState<Map<string, UnlockedState>>(new Map());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingFolder, setEditingFolder]       = useState<VaultFolder | null>(null);
  const [unlockTarget, setUnlockTarget]         = useState<VaultFolder | null>(null);
  const [draggingOver, setDraggingOver]         = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const liveFolder = selectedId ? folders.find(f => f.id === selectedId) ?? null : null;
  const liveFolderState = selectedId ? unlocked.get(selectedId) ?? null : null;
  const isUnlocked = (id: string) => unlocked.has(id);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const encryptFiles = useCallback(async (files: VaultFile[], password: string): Promise<string> => {
    const json = JSON.stringify(files);
    const data = new TextEncoder().encode(json).buffer;
    const enc = await encryptVault(data, password);
    return serializeVault(enc);
  }, []);

  const decryptFiles = useCallback(async (encryptedFiles: string, password: string): Promise<VaultFile[]> => {
    const vaultData = deserializeVault(encryptedFiles);
    const decrypted = await decryptVault(vaultData, password);
    return JSON.parse(new TextDecoder().decode(decrypted)) as VaultFile[];
  }, []);

  const saveFiles = useCallback(async (folderId: string, files: VaultFile[], password: string) => {
    const encryptedFiles = await encryptFiles(files, password);
    onChange(folders.map(f =>
      f.id === folderId ? { ...f, encryptedFiles, updatedAt: new Date().toISOString() } : f
    ));
    setUnlocked(prev => {
      const next = new Map(prev);
      next.set(folderId, { password, files });
      return next;
    });
  }, [folders, onChange, encryptFiles]);

  // ── Folder CRUD ──────────────────────────────────────────────────────────────

  const handleCreateFolder = useCallback(async (name: string, color: string, password: string) => {
    const now = new Date().toISOString();
    const id = generateId();
    const encryptedFiles = await encryptFiles([], password);
    const folder: VaultFolder = { id, name: name.trim(), color, encryptedFiles, createdAt: now, updatedAt: now };
    onChange([...folders, folder]);
    // Unlock immediately on create
    setUnlocked(prev => { const n = new Map(prev); n.set(id, { password, files: [] }); return n; });
    setSelectedId(id);
    setShowCreateDialog(false);
    addToast({ type: 'success', title: 'Pasta criada e desbloqueada!' });
  }, [folders, onChange, encryptFiles, addToast]);

  const handleRenameFolder = useCallback((id: string, name: string, color: string) => {
    onChange(folders.map(f => f.id === id ? { ...f, name: name.trim(), color, updatedAt: new Date().toISOString() } : f));
    setEditingFolder(null);
    addToast({ type: 'success', title: 'Pasta renomeada!' });
  }, [folders, onChange, addToast]);

  const handleDeleteFolder = useCallback((id: string) => {
    onChange(folders.filter(f => f.id !== id));
    if (selectedId === id) { setSelectedId(null); setSelectedFileId(null); }
    setUnlocked(prev => { const n = new Map(prev); n.delete(id); return n; });
    addToast({ type: 'info', title: 'Pasta removida' });
  }, [folders, onChange, selectedId, addToast]);

  // ── Unlock ────────────────────────────────────────────────────────────────────

  const handleUnlock = useCallback(async (folder: VaultFolder, password: string): Promise<boolean> => {
    try {
      const files = folder.encryptedFiles
        ? await decryptFiles(folder.encryptedFiles, password)
        : [];
      setUnlocked(prev => { const n = new Map(prev); n.set(folder.id, { password, files }); return n; });
      setUnlockTarget(null);
      setSelectedId(folder.id);
      setSelectedFileId(null);
      addToast({ type: 'success', title: `"${folder.name}" desbloqueada` });
      return true;
    } catch {
      return false; // wrong password
    }
  }, [decryptFiles, addToast]);

  const handleLock = useCallback((id: string) => {
    setUnlocked(prev => { const n = new Map(prev); n.delete(id); return n; });
    setSelectedId(null);
    setSelectedFileId(null);
    addToast({ type: 'info', title: 'Pasta bloqueada' });
  }, [addToast]);

  // ── File upload ───────────────────────────────────────────────────────────────

  const uploadFiles = useCallback((fileList: FileList | null, folderId: string) => {
    if (!fileList) return;
    const state = unlocked.get(folderId);
    if (!state) return;

    const newFiles: VaultFile[] = [];
    let processed = 0;

    Array.from(fileList).forEach(file => {
      if (file.size > MAX_FILE_BYTES) {
        addToast({ type: 'error', title: `"${file.name}" excede 50 MB` });
        processed++;
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1] ?? '';
        newFiles.push({ id: generateId(), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, data: base64, createdAt: new Date().toISOString() });
        processed++;
        if (processed === fileList.length && newFiles.length > 0) {
          const allFiles = [...state.files, ...newFiles];
          await saveFiles(folderId, allFiles, state.password);
          addToast({ type: 'success', title: `${newFiles.length} arquivo(s) adicionado(s)` });
        }
      };
      reader.onerror = () => { processed++; addToast({ type: 'error', title: `Erro ao ler "${file.name}"` }); };
      reader.readAsDataURL(file);
    });
  }, [unlocked, saveFiles, addToast]);

  const handleDeleteFile = useCallback(async (folderId: string, fileId: string) => {
    const state = unlocked.get(folderId);
    if (!state) return;
    const files = state.files.filter(f => f.id !== fileId);
    await saveFiles(folderId, files, state.password);
    if (selectedFileId === fileId) setSelectedFileId(null);
    addToast({ type: 'info', title: 'Arquivo removido' });
  }, [unlocked, saveFiles, selectedFileId, addToast]);

  const handleDownloadFile = useCallback((file: VaultFile) => {
    const byteChars = atob(file.data);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'info', title: `"${file.name}" baixado` });
  }, [addToast]);

  // ── Drag & Drop ───────────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault(); setDraggingOver(false);
    uploadFiles(e.dataTransfer.files, folderId);
  }, [uploadFiles]);

  // ── Selected file ─────────────────────────────────────────────────────────────

  const selectedFile = liveFolderState?.files.find(f => f.id === selectedFileId) ?? null;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Pane 2 ── */}
      <div style={{ width: 296, flexShrink: 0, background: '#0a0a0f', borderRight: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!liveFolder ? (
          /* Folder list */
          <>
            <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 600, color: tokens.colors.neutral9 }}>Pastas Seguras</span>
                <button onClick={() => { setEditingFolder(null); setShowCreateDialog(true); }} style={actionBtn}>+ Nova</button>
              </div>
              <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral5, marginTop: 6 }}>
                {folders.length} {folders.length === 1 ? 'pasta' : 'pastas'} · protegidas por senha individual
              </p>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
              {folders.length === 0 ? (
                <EmptyFolders onNew={() => setShowCreateDialog(true)} />
              ) : (
                folders.map(folder => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    unlocked={isUnlocked(folder.id)}
                    onClick={() => {
                      if (isUnlocked(folder.id)) { setSelectedId(folder.id); setSelectedFileId(null); }
                      else setUnlockTarget(folder);
                    }}
                    onEdit={() => { setEditingFolder(folder); setShowCreateDialog(true); }}
                    onDelete={() => handleDeleteFolder(folder.id)}
                    onLock={() => handleLock(folder.id)}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          /* File list */
          <>
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <button
                onClick={() => { setSelectedId(null); setSelectedFileId(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.colors.neutral6, fontFamily: tokens.typography.fontFamily, fontSize: '12px', padding: '0 0 8px', display: 'flex', alignItems: 'center', gap: 5, transition: 'color 0.14s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = liveFolder.color; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = tokens.colors.neutral6; }}
              >
                <ChevronLeftIcon /> Pastas
              </button>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: liveFolder.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 600, color: tokens.colors.neutral9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {liveFolder.name}
                  </span>
                </div>
                <button onClick={() => fileInputRef.current?.click()} style={actionBtn}>+ Upload</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral5, flex: 1 }}>
                  {liveFolderState?.files.length ?? 0} arquivo(s)
                </p>
                <button onClick={() => handleLock(liveFolder.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(79,152,163,0.5)', fontFamily: tokens.typography.fontFamily, fontSize: '10px', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
                  title="Bloquear pasta">
                  <LockSmallIcon /> Bloquear
                </button>
              </div>
            </div>

            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
              onChange={e => { uploadFiles(e.target.files, liveFolder.id); e.target.value = ''; }} />

            <div
              onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
              onDragLeave={() => setDraggingOver(false)}
              onDrop={e => handleDrop(e, liveFolder.id)}
              style={{ flex: 1, overflowY: 'auto', padding: '10px', position: 'relative', border: draggingOver ? '1px dashed rgba(79,152,163,0.4)' : '1px solid transparent', borderRadius: 8, margin: 4, transition: 'border-color 0.14s' }}
            >
              {draggingOver && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(79,152,163,0.06)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                  <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: '#4f98a3', fontWeight: 600 }}>Soltar aqui</span>
                </div>
              )}
              {(liveFolderState?.files.length ?? 0) === 0 ? (
                <EmptyFiles onUpload={() => fileInputRef.current?.click()} />
              ) : (
                liveFolderState!.files.map(file => (
                  <FileRow
                    key={file.id} file={file}
                    selected={selectedFileId === file.id}
                    onClick={() => setSelectedFileId(selectedFileId === file.id ? null : file.id)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Pane 3 ── */}
      <div style={{ flex: 1, background: '#0c0c12', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {liveFolder && selectedFile ? (
          <FileDetailPane
            file={selectedFile} folder={liveFolder}
            onDownload={() => handleDownloadFile(selectedFile)}
            onDelete={() => handleDeleteFile(liveFolder.id, selectedFile.id)}
          />
        ) : liveFolder ? (
          <FolderDetailPane
            folder={liveFolder}
            fileCount={liveFolderState?.files.length ?? 0}
            totalSize={liveFolderState?.files.reduce((s, f) => s + f.size, 0) ?? 0}
            onUpload={() => fileInputRef.current?.click()}
            onEdit={() => { setEditingFolder(liveFolder); setShowCreateDialog(true); }}
            onDelete={() => handleDeleteFolder(liveFolder.id)}
            onLock={() => handleLock(liveFolder.id)}
          />
        ) : (
          <FolderEmptyDetail onNew={() => setShowCreateDialog(true)} />
        )}
      </div>

      {/* ── Dialogs ── */}
      {unlockTarget && (
        <UnlockDialog
          folder={unlockTarget}
          onUnlock={(pwd) => handleUnlock(unlockTarget, pwd)}
          onClose={() => setUnlockTarget(null)}
        />
      )}
      {showCreateDialog && (
        <FolderDialog
          initial={editingFolder}
          onSave={(name, color, password) => {
            if (editingFolder) handleRenameFolder(editingFolder.id, name, color);
            else handleCreateFolder(name, color, password!);
          }}
          onClose={() => { setShowCreateDialog(false); setEditingFolder(null); }}
        />
      )}
    </>
  );
};

// ── UnlockDialog ──────────────────────────────────────────────────────────────

function UnlockDialog({ folder, onUnlock, onClose }: {
  folder: VaultFolder;
  onUnlock: (password: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [show, setShow]         = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleTry = async () => {
    if (!password) return;
    setLoading(true); setError('');
    const ok = await onUnlock(password);
    setLoading(false);
    if (!ok) { setError('Senha incorreta'); setPassword(''); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 360, padding: '28px', background: 'rgba(10,10,18,0.99)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, boxShadow: '0 24px 64px rgba(0,0,0,0.8)', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, borderRadius: '18px 18px 0 0', background: `linear-gradient(90deg, ${folder.color}, transparent)` }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: `${folder.color}18`, border: `1px solid ${folder.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FolderIcon color={folder.color} size={20} />
          </div>
          <div>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '14px', fontWeight: 700, color: tokens.colors.neutral12 }}>{folder.name}</p>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral5, marginTop: 2 }}>Digite a senha desta pasta</p>
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: error ? 8 : 20 }}>
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleTry(); if (e.key === 'Escape') onClose(); }}
            placeholder="Senha da pasta"
            autoFocus
            style={{ width: '100%', padding: '11px 44px 11px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${error ? 'rgba(209,99,167,0.5)' : 'rgba(255,255,255,0.09)'}`, borderRadius: 10, color: '#f0f0f0', fontFamily: tokens.typography.fontFamily, fontSize: '14px', outline: 'none', transition: 'border-color 0.15s' }}
          />
          <button onClick={() => setShow(v => !v)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: tokens.colors.neutral6, padding: 2, display: 'flex' }}>
            {show ? <EyeOffIcon /> : <EyeOnIcon />}
          </button>
        </div>

        {error && <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: '#e87da0', marginBottom: 14 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
          <button onClick={handleTry} disabled={!password || loading} style={{ ...primaryBtn, flex: 1, justifyContent: 'center', opacity: !password || loading ? 0.5 : 1, cursor: !password || loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Verificando...' : 'Desbloquear'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FolderCard ────────────────────────────────────────────────────────────────

function FolderCard({ folder, unlocked, onClick, onEdit, onDelete, onLock }: {
  folder: VaultFolder; unlocked: boolean;
  onClick: () => void; onEdit: () => void;
  onDelete: () => void; onLock: () => void;
}) {
  const [hov, setHov] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setHov(false); setMenuOpen(false); }}
      style={{
        padding: '11px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 4,
        background: hov ? `${folder.color}0c` : 'transparent',
        border: `1px solid ${hov ? `${folder.color}20` : 'transparent'}`,
        borderLeft: `3px solid ${hov ? folder.color : 'rgba(255,255,255,0.05)'}`,
        transition: 'all 0.14s', display: 'flex', alignItems: 'center', gap: 11, position: 'relative',
      }}
    >
      {/* Icon */}
      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: `${folder.color}18`, border: `1px solid ${folder.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <FolderIcon color={folder.color} />
        {/* Lock overlay */}
        {!unlocked && (
          <div style={{ position: 'absolute', bottom: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#0a0a0f', border: `1px solid ${folder.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke={folder.color} strokeWidth={2.5}>
              <rect x={3} y={11} width={18} height={11} rx={2} /><path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
        )}
        {unlocked && (
          <div style={{ position: 'absolute', bottom: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#0a0a0f', border: '1px solid rgba(109,170,69,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#6daa45" strokeWidth={2.5}>
              <rect x={3} y={11} width={18} height={11} rx={2} /><path d="M7 11V7a5 5 0 019.9-1" />
            </svg>
          </div>
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 600, color: tokens.colors.neutral11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {folder.name}
        </div>
        <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: unlocked ? 'rgba(109,170,69,0.7)' : tokens.colors.neutral5, marginTop: 2 }}>
          {unlocked ? 'Desbloqueada · clique para abrir' : 'Protegida · clique para desbloquear'}
        </div>
      </div>

      {/* Menu */}
      {hov && (
        <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', color: tokens.colors.neutral6, fontSize: '14px', lineHeight: 1 }}>···</button>
          {menuOpen && (
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#13131e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, padding: 4, zIndex: 100, minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
              <MenuBtn onClick={() => { setMenuOpen(false); onEdit(); }}>Renomear</MenuBtn>
              {unlocked && <MenuBtn onClick={() => { setMenuOpen(false); onLock(); }}>Bloquear</MenuBtn>}
              <MenuBtn onClick={() => { setMenuOpen(false); onDelete(); }} danger>Excluir pasta</MenuBtn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({ file, selected, onClick }: { file: VaultFile; selected: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ padding: '9px 11px', borderRadius: 9, cursor: 'pointer', marginBottom: 3, background: selected ? 'rgba(79,152,163,0.1)' : hov ? 'rgba(255,255,255,0.03)' : 'transparent', border: `1px solid ${selected ? 'rgba(79,152,163,0.25)' : 'transparent'}`, borderLeft: `2px solid ${selected ? '#4f98a3' : 'transparent'}`, transition: 'all 0.13s', display: 'flex', alignItems: 'center', gap: 10 }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FileTypeIcon mimeType={file.mimeType} size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', fontWeight: 500, color: tokens.colors.neutral11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
        <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: tokens.colors.neutral5, marginTop: 1 }}>{formatBytes(file.size)} · {formatDate(file.createdAt)}</div>
      </div>
    </div>
  );
}

// ── FileDetailPane ────────────────────────────────────────────────────────────

function FileDetailPane({ file, folder, onDownload, onDelete }: { file: VaultFile; folder: VaultFolder; onDownload: () => void; onDelete: () => void }) {
  const isImage = file.mimeType.startsWith('image/');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FileTypeIcon mimeType={file.mimeType} size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontFamily: tokens.typography.fontFamily, fontSize: '16px', fontWeight: 700, color: tokens.colors.neutral12, wordBreak: 'break-all' }}>{file.name}</h2>
          <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral6, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: folder.color }} />
            {folder.name} · {formatBytes(file.size)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {isImage && (
          <div style={{ marginBottom: 20, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
            <img src={`data:${file.mimeType};base64,${file.data}`} alt={file.name} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)', padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <MetaBlock label="Nome" value={file.name} />
          <MetaBlock label="Tamanho" value={formatBytes(file.size)} />
          <MetaBlock label="Tipo" value={file.mimeType} />
          <MetaBlock label="Adicionado" value={formatDate(file.createdAt)} />
        </div>
        <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(79,152,163,0.06)', border: '1px solid rgba(79,152,163,0.15)', borderRadius: 10, display: 'flex', gap: 10 }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>🔒</span>
          <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(79,152,163,0.8)', lineHeight: 1.5, margin: 0 }}>
            Criptografado com AES-256-GCM pela senha desta pasta — separada da senha mestra.
          </p>
        </div>
      </div>

      <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8 }}>
        <button onClick={onDownload} style={primaryBtn}><DownloadIcon /> Baixar arquivo</button>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={onDelete} style={dangerBtn}>Excluir</button>
        </div>
      </div>
    </div>
  );
}

// ── FolderDetailPane ──────────────────────────────────────────────────────────

function FolderDetailPane({ folder, fileCount, totalSize, onUpload, onEdit, onDelete, onLock }: {
  folder: VaultFolder; fileCount: number; totalSize: number;
  onUpload: () => void; onEdit: () => void; onDelete: () => void; onLock: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, flexShrink: 0, background: `${folder.color}18`, border: `1px solid ${folder.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FolderIcon color={folder.color} size={26} />
        </div>
        <div>
          <h2 style={{ fontFamily: tokens.typography.fontFamily, fontSize: '18px', fontWeight: 700, color: tokens.colors.neutral12 }}>{folder.name}</h2>
          <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: 'rgba(109,170,69,0.7)', marginTop: 4 }}>
            Desbloqueada · {fileCount} arquivo(s) · {formatBytes(totalSize)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.15 }}>📁</div>
          <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral6 }}>Selecione um arquivo para ver detalhes</p>
        </div>
        <button onClick={onUpload} style={primaryBtn}><UploadIcon /> Adicionar arquivos</button>
      </div>

      <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8 }}>
        <button onClick={onEdit} style={secondaryBtn}>Renomear</button>
        <button onClick={onLock} style={secondaryBtn}><LockSmallIcon /> Bloquear</button>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={onDelete} style={dangerBtn}>Excluir pasta</button>
        </div>
      </div>
    </div>
  );
}

// ── FolderEmptyDetail ─────────────────────────────────────────────────────────

function FolderEmptyDetail({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(253,171,67,0.06)', border: '1px solid rgba(253,171,67,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FolderIcon color="rgba(253,171,67,0.4)" size={30} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '15px', fontWeight: 600, color: tokens.colors.neutral7 }}>Pastas Seguras</p>
        <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral5, marginTop: 6, lineHeight: 1.6, maxWidth: 280 }}>
          Cada pasta tem sua própria senha, separada da senha mestra. Os arquivos só ficam visíveis após desbloquear.
        </p>
      </div>
      <button onClick={onNew} style={primaryBtn}>+ Criar primeira pasta</button>
    </div>
  );
}

// ── EmptyFolders / EmptyFiles ─────────────────────────────────────────────────

function EmptyFolders({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ paddingTop: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 30, marginBottom: 12, opacity: 0.2 }}>📁</div>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral6, marginBottom: 14 }}>Nenhuma pasta criada</p>
      <button onClick={onNew} style={actionBtn}>+ Criar pasta</button>
    </div>
  );
}

function EmptyFiles({ onUpload }: { onUpload: () => void }) {
  return (
    <div style={{ paddingTop: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 26, marginBottom: 12, opacity: 0.2 }}>📄</div>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral6, marginBottom: 6 }}>Pasta vazia</p>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral5, marginBottom: 14 }}>Arraste arquivos ou use o botão Upload</p>
      <button onClick={onUpload} style={actionBtn}>Upload</button>
    </div>
  );
}

// ── FolderDialog (create / rename) ────────────────────────────────────────────

function FolderDialog({ initial, onSave, onClose }: {
  initial: VaultFolder | null;
  onSave: (name: string, color: string, password?: string) => void;
  onClose: () => void;
}) {
  const [name, setName]       = useState(initial?.name ?? '');
  const [color, setColor]     = useState(initial?.color ?? FOLDER_COLORS[0]);
  const [pwd, setPwd]         = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const isEdit = initial !== null;

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Nome obrigatório';
    if (!isEdit) {
      if (pwd.length < MIN_FOLDER_PWD) e.pwd = `Mínimo ${MIN_FOLDER_PWD} caracteres`;
      if (confirm !== pwd) e.confirm = 'As senhas não coincidem';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave(name, color, isEdit ? undefined : pwd);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 400, padding: '28px', background: 'rgba(10,10,18,0.99)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, boxShadow: '0 24px 64px rgba(0,0,0,0.8)', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, borderRadius: '18px 18px 0 0', background: `linear-gradient(90deg, ${color}, transparent)` }} />

        <h3 style={{ fontFamily: tokens.typography.fontFamily, fontSize: '16px', fontWeight: 700, color: tokens.colors.neutral12, marginBottom: 22 }}>
          {isEdit ? 'Renomear pasta' : 'Nova pasta segura'}
        </h3>

        {/* Name */}
        <Field label="Nome" error={errors.name}>
          <input type="text" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
            placeholder="Ex: Documentos pessoais" autoFocus
            onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
            style={fieldInput(!!errors.name)} />
        </Field>

        {/* Color */}
        <div style={{ marginBottom: 20 }}>
          <label style={fieldLabel}>Cor</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {FOLDER_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${color === c ? c : 'transparent'}`, background: c, cursor: 'pointer', padding: 0, outline: 'none', boxShadow: color === c ? `0 0 0 3px rgba(0,0,0,0.5), 0 0 10px ${c}60` : 'none', transition: 'all 0.15s' }} />
            ))}
          </div>
        </div>

        {/* Password — only on create */}
        {!isEdit && (
          <>
            <Field label="Senha da pasta" error={errors.pwd}>
              <div style={{ position: 'relative' }}>
                <input type={showPwd ? 'text' : 'password'} value={pwd}
                  onChange={e => { setPwd(e.target.value); setErrors(p => ({ ...p, pwd: '' })); }}
                  placeholder={`Mínimo ${MIN_FOLDER_PWD} caracteres`}
                  style={{ ...fieldInput(!!errors.pwd), paddingRight: 44 }} />
                <EyeBtn show={showPwd} onToggle={() => setShowPwd(v => !v)} />
              </div>
            </Field>
            <Field label="Confirmar senha" error={errors.confirm}>
              <div style={{ position: 'relative' }}>
                <input type={showPwd ? 'text' : 'password'} value={confirm}
                  onChange={e => { setConfirm(e.target.value); setErrors(p => ({ ...p, confirm: '' })); }}
                  placeholder="Repita a senha"
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
                  style={{ ...fieldInput(!!errors.confirm), paddingRight: 44 }} />
                <EyeBtn show={showPwd} onToggle={() => setShowPwd(v => !v)} />
              </div>
            </Field>
            <div style={{ padding: '9px 12px', background: 'rgba(253,171,67,0.06)', border: '1px solid rgba(253,171,67,0.18)', borderRadius: 9, marginBottom: 20 }}>
              <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(253,171,67,0.8)', lineHeight: 1.5, margin: 0 }}>
                Esta senha é <strong>separada da senha mestra</strong> e não pode ser recuperada. Guarde-a em segurança.
              </p>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
          <button onClick={handleSave} style={primaryBtn}>{isEdit ? 'Salvar' : 'Criar pasta'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={fieldLabel}>{label}</label>
      {children}
      {error && <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: '#e87da0', marginTop: 4 }}>{error}</p>}
    </div>
  );
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: tokens.colors.neutral6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral9, marginTop: 3, wordBreak: 'break-all' }}>{value}</p>
    </div>
  );
}

function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{ width: '100%', padding: '7px 10px', background: hov ? (danger ? 'rgba(209,99,167,0.1)' : 'rgba(255,255,255,0.06)') : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left', fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: danger ? (hov ? '#e87da0' : 'rgba(232,125,160,0.7)') : (hov ? tokens.colors.neutral9 : tokens.colors.neutral7), display: 'block', transition: 'all 0.12s' }}>
      {children}
    </button>
  );
}

function EyeBtn({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: tokens.colors.neutral6, padding: 2, display: 'flex' }}>
      {show ? <EyeOffIcon /> : <EyeOnIcon />}
    </button>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FolderIcon({ color, size = 18 }: { color: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>;
}

function FileTypeIcon({ mimeType, size = 14 }: { mimeType: string; size?: number }) {
  const s = { width: size, height: size, fill: 'none', strokeWidth: 1.5 };
  if (mimeType.startsWith('image/')) return <svg viewBox="0 0 24 24" style={s} stroke="#9b7de8"><rect x={3} y={3} width={18} height={18} rx={2} /><circle cx={8.5} cy={8.5} r={1.5} /><polyline points="21 15 16 10 5 21" /></svg>;
  if (mimeType === 'application/pdf') return <svg viewBox="0 0 24 24" style={s} stroke="#e87da0"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>;
  if (mimeType.startsWith('video/')) return <svg viewBox="0 0 24 24" style={s} stroke="#fdab43"><polygon points="23 7 16 12 23 17 23 7" /><rect x={1} y={5} width={15} height={14} rx={2} /></svg>;
  if (mimeType.startsWith('audio/')) return <svg viewBox="0 0 24 24" style={s} stroke="#6daa45"><path d="M9 18V5l12-2v13" /><circle cx={6} cy={18} r={3} /><circle cx={18} cy={16} r={3} /></svg>;
  return <svg viewBox="0 0 24 24" style={s} stroke="rgba(255,255,255,0.35)"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}

function ChevronLeftIcon() { return <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="15 18 9 12 15 6" /></svg>; }
function DownloadIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>; }
function UploadIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>; }
function LockSmallIcon() { return <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x={3} y={11} width={18} height={11} rx={2} /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>; }
function EyeOnIcon() { return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>; }
function EyeOffIcon() { return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>; }

// ── Utils ─────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Styles ────────────────────────────────────────────────────────────────────

const fieldLabel: React.CSSProperties = {
  display: 'block', fontFamily: tokens.typography.fontFamily,
  fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em',
  color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 7,
};

const fieldInput = (hasError: boolean): React.CSSProperties => ({
  width: '100%', padding: '10px 14px',
  background: 'rgba(255,255,255,0.05)',
  border: `1px solid ${hasError ? 'rgba(209,99,167,0.5)' : 'rgba(255,255,255,0.09)'}`,
  borderRadius: 10, color: '#f0f0f0',
  fontFamily: tokens.typography.fontFamily, fontSize: '14px', outline: 'none',
});

const actionBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6,
  background: 'rgba(79,152,163,0.15)', border: '1px solid rgba(79,152,163,0.25)',
  color: '#4f98a3', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '11px', fontWeight: 600, cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 9,
  background: 'rgba(79,152,163,0.18)', border: '1px solid rgba(79,152,163,0.3)',
  color: '#4f98a3', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 7,
};

const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 9,
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
  color: tokens.colors.neutral8, fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '13px', fontWeight: 500, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 6,
};

const dangerBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 9,
  background: 'rgba(209,99,167,0.1)', border: '1px solid rgba(209,99,167,0.2)',
  color: '#e87da0', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '13px', fontWeight: 500, cursor: 'pointer',
};
