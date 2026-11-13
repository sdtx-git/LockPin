import React, { useState, useRef, useCallback } from 'react';
import { useToast, Modal } from '@ui/components/organisms';
import { Button } from '@ui/components/atoms';
import { generateId, saveFile } from '@shared/utils';
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

  const handleDownloadFile = useCallback(async (file: VaultFile) => {
    const byteChars = atob(file.data);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    try {
      await saveFile(file.name, byteArr, file.mimeType);
      addToast({ type: 'info', title: `"${file.name}" baixado` });
    } catch { addToast({ type: 'error', title: 'Falha ao baixar arquivo' }); }
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
      <div style={{ width: 304, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!liveFolder ? (
          <>
            <div style={paneHeader}>
              <div>
                <h2 style={paneTitle}>Pastas seguras</h2>
                <p style={paneSub}>{folders.length} {folders.length === 1 ? 'pasta' : 'pastas'}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => { setEditingFolder(null); setShowCreateDialog(true); }}>Nova pasta</Button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
              {folders.length === 0 ? (
                <EmptyHint title="Nenhuma pasta ainda" text="Crie uma pasta para guardar arquivos cifrados." />
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
          <>
            <div style={{ padding: '10px 12px 0' }}>
              <button type="button" className="link-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => { setSelectedId(null); setSelectedFileId(null); }}>
                <ChevronLeftIcon /> Todas as pastas
              </button>
            </div>
            <div style={paneHeader}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ ...paneTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ColorDot color={liveFolder.color} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{liveFolder.name}</span>
                </h2>
                <p style={paneSub}>{liveFolderState?.files.length ?? 0} {(liveFolderState?.files.length ?? 0) === 1 ? 'arquivo' : 'arquivos'}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>Adicionar</Button>
            </div>

            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
              onChange={e => { uploadFiles(e.target.files, liveFolder.id); e.target.value = ''; }} />

            <div
              onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
              onDragLeave={() => setDraggingOver(false)}
              onDrop={e => handleDrop(e, liveFolder.id)}
              style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', position: 'relative' }}
            >
              {draggingOver && (
                <div style={{ position: 'absolute', inset: 6, background: 'var(--accent-soft)', border: '2px dashed var(--accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500 }}>Solte para adicionar à pasta</span>
                </div>
              )}
              {(liveFolderState?.files.length ?? 0) === 0 ? (
                <EmptyHint title="Pasta vazia" text="Arraste arquivos para cá ou use Adicionar. Limite de 50 MB por arquivo." />
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
      <div style={{ flex: 1, background: 'var(--canvas)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
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
    if (!ok) { setError('Senha incorreta. Tente de novo.'); setPassword(''); }
  };

  return (
    <Modal open onClose={onClose} title={`Desbloquear "${folder.name}"`} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleTry} disabled={!password} loading={loading}>Desbloquear</Button>
      </>}
    >
      <Field label="Senha da pasta" error={error}>
        <div style={{ position: 'relative' }}>
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleTry(); }}
            autoFocus
            className={`input${error ? ' input--error' : ''}`}
            style={{ paddingRight: 40 }}
          />
          <EyeBtn show={show} onToggle={() => setShow(v => !v)} />
        </div>
      </Field>
    </Modal>
  );
}

// ── FolderCard ────────────────────────────────────────────────────────────────

function FolderCard({ folder, unlocked, onClick, onEdit, onDelete, onLock }: {
  folder: VaultFolder; unlocked: boolean;
  onClick: () => void; onEdit: () => void;
  onDelete: () => void; onLock: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div role="button" tabIndex={0} className="list-item" style={{ cursor: 'pointer', position: 'relative' }}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter') onClick(); }}
      onMouseLeave={() => setMenuOpen(false)}
    >
      <span className="tile"><FolderIcon color="currentColor" size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="list-item__title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <ColorDot color={folder.color} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder.name}</span>
        </div>
        <div className="list-item__sub">{unlocked ? 'Desbloqueada' : 'Bloqueada'}</div>
      </div>

      <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button type="button" className="icon-btn" aria-label={`Ações da pasta ${folder.name}`} aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor"><circle cx={5} cy={12} r={1.7} /><circle cx={12} cy={12} r={1.7} /><circle cx={19} cy={12} r={1.7} /></svg>
        </button>
        {menuOpen && (
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 4, zIndex: 100, minWidth: 150, boxShadow: 'var(--shadow-pop)' }}>
            <MenuBtn onClick={() => { setMenuOpen(false); onEdit(); }}>Renomear</MenuBtn>
            {unlocked && <MenuBtn onClick={() => { setMenuOpen(false); onLock(); }}>Bloquear</MenuBtn>}
            <MenuBtn onClick={() => { setMenuOpen(false); onDelete(); }} danger>Excluir pasta</MenuBtn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({ file, selected, onClick }: { file: VaultFile; selected: boolean; onClick: () => void }) {
  return (
    <div role="option" tabIndex={0} aria-selected={selected} className="list-item" style={{ cursor: 'pointer' }}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <span className="tile"><FileTypeIcon mimeType={file.mimeType} size={15} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="list-item__title">{file.name}</div>
        <div className="list-item__sub">{formatBytes(file.size)} · {formatDate(file.createdAt)}</div>
      </div>
    </div>
  );
}

// ── FileDetailPane ────────────────────────────────────────────────────────────

function FileDetailPane({ file, folder, onDownload, onDelete }: { file: VaultFile; folder: VaultFolder; onDownload: () => void; onDelete: () => void }) {
  const isImage = file.mimeType.startsWith('image/');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={detailColumn}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <span className="tile tile--lg"><FileTypeIcon mimeType={file.mimeType} size={19} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={detailTitle}>{file.name}</h2>
              <p style={paneSub}>{folder.name} · {formatBytes(file.size)}</p>
            </div>
          </div>

          {isImage && (
            <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
              <img src={`data:${file.mimeType};base64,${file.data}`} alt={file.name} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }} />
            </div>
          )}
          <div className="card">
            <MetaBlock label="Tipo" value={file.mimeType || 'Desconhecido'} />
            <MetaBlock label="Tamanho" value={formatBytes(file.size)} />
            <MetaBlock label="Adicionado" value={formatDate(file.createdAt)} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.5 }}>
            Cifrado com AES-256-GCM pela senha desta pasta, que é separada da senha mestra.
          </p>
        </div>
      </div>

      <div style={actionBar}>
        <Button onClick={onDownload}><DownloadIcon /> Baixar</Button>
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="danger" onClick={onDelete}>Excluir arquivo</Button>
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
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={detailColumn}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <span className="tile tile--lg"><FolderIcon color="currentColor" size={19} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ ...detailTitle, display: 'flex', alignItems: 'center', gap: 8 }}><ColorDot color={folder.color} />{folder.name}</h2>
              <p style={paneSub}>Desbloqueada · {fileCount} {fileCount === 1 ? 'arquivo' : 'arquivos'} · {formatBytes(totalSize)}</p>
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 14 }}>
            Escolha um arquivo na lista para ver os detalhes ou baixá-lo.
          </p>
          <Button variant="secondary" onClick={onUpload}><UploadIcon /> Adicionar arquivos</Button>
        </div>
      </div>

      <div style={actionBar}>
        <Button variant="secondary" onClick={onEdit}>Renomear</Button>
        <Button variant="secondary" onClick={onLock}>Bloquear</Button>
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="danger" onClick={onDelete}>Excluir pasta</Button>
        </div>
      </div>
    </div>
  );
}

// ── Estados vazios ────────────────────────────────────────────────────────────

function FolderEmptyDetail({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-2)' }}>Arquivos com senha própria</p>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.55, maxWidth: 320 }}>
        Cada pasta é cifrada com uma senha separada da senha mestra. Os arquivos só aparecem depois de desbloquear.
      </p>
      <div style={{ marginTop: 18 }}>
        <Button onClick={onNew}>Nova pasta</Button>
      </div>
    </div>
  );
}

function EmptyHint({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ padding: '36px 16px', textAlign: 'center' }}>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>{title}</p>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{text}</p>
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
    if (!name.trim()) e.name = 'Informe um nome para a pasta';
    if (!isEdit) {
      if (pwd.length < MIN_FOLDER_PWD) e.pwd = `Use pelo menos ${MIN_FOLDER_PWD} caracteres`;
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
    <Modal open onClose={onClose} title={isEdit ? 'Renomear pasta' : 'Nova pasta segura'} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleSave}>{isEdit ? 'Salvar alterações' : 'Criar pasta'}</Button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Nome" error={errors.name}>
          <input type="text" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
            autoFocus className={`input${errors.name ? ' input--error' : ''}`} />
        </Field>

        <div>
          <span className="field-label">Cor</span>
          <div style={{ display: 'flex', gap: 10 }}>
            {FOLDER_COLORS.map(c => (
              <button key={c} type="button" aria-label={`Cor ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: c, padding: 0, boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none' }} />
            ))}
          </div>
        </div>

        {!isEdit && (
          <>
            <Field label="Senha da pasta" error={errors.pwd}>
              <div style={{ position: 'relative' }}>
                <input type={showPwd ? 'text' : 'password'} value={pwd}
                  onChange={e => { setPwd(e.target.value); setErrors(p => ({ ...p, pwd: '' })); }}
                  className={`input${errors.pwd ? ' input--error' : ''}`} style={{ paddingRight: 40 }} />
                <EyeBtn show={showPwd} onToggle={() => setShowPwd(v => !v)} />
              </div>
            </Field>
            <Field label="Confirmar senha" error={errors.confirm}>
              <input type={showPwd ? 'text' : 'password'} value={confirm}
                onChange={e => { setConfirm(e.target.value); setErrors(p => ({ ...p, confirm: '' })); }}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                className={`input${errors.confirm ? ' input--error' : ''}`} />
            </Field>
            <p className="note">
              Esta senha é separada da senha mestra e não pode ser recuperada. Sem ela, os arquivos da pasta ficam inacessíveis.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="card__row" style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-all', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function ColorDot({ color }: { color: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />;
}

function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={danger ? 'btn btn--ghost btn--sm btn--full menu-danger' : 'btn btn--ghost btn--sm btn--full'}
      style={{ justifyContent: 'flex-start', color: danger ? 'var(--danger)' : undefined }}>
      {children}
    </button>
  );
}

function EyeBtn({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="icon-btn" style={{ position: 'absolute', right: 5, top: 5 }}
      aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
      {show ? <EyeOffIcon /> : <EyeOnIcon />}
    </button>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FolderIcon({ color, size = 18 }: { color: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>;
}

function FileTypeIcon({ mimeType, size = 14 }: { mimeType: string; size?: number }) {
  const s = { width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  if (mimeType.startsWith('image/')) return <svg viewBox="0 0 24 24" style={s}><rect x={3} y={3} width={18} height={18} rx={2} /><circle cx={8.5} cy={8.5} r={1.5} /><polyline points="21 15 16 10 5 21" /></svg>;
  if (mimeType.startsWith('video/')) return <svg viewBox="0 0 24 24" style={s}><polygon points="23 7 16 12 23 17 23 7" /><rect x={1} y={5} width={15} height={14} rx={2} /></svg>;
  if (mimeType.startsWith('audio/')) return <svg viewBox="0 0 24 24" style={s}><path d="M9 18V5l12-2v13" /><circle cx={6} cy={18} r={3} /><circle cx={18} cy={16} r={3} /></svg>;
  return <svg viewBox="0 0 24 24" style={s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}

function ChevronLeftIcon() { return <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><polyline points="15 18 9 12 15 6" /></svg>; }
function DownloadIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>; }
function UploadIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>; }
function EyeOnIcon() { return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx={12} cy={12} r={3} /></svg>; }
function EyeOffIcon() { return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" /></svg>; }

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

const paneHeader: React.CSSProperties = { padding: '12px 12px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const paneTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--text)' };
const paneSub: React.CSSProperties = { fontSize: 12, color: 'var(--text-3)', marginTop: 2 };
const detailColumn: React.CSSProperties = { maxWidth: 640, margin: '0 auto', padding: '28px 28px 32px' };
const detailTitle: React.CSSProperties = { fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)', lineHeight: 1.25, wordBreak: 'break-all' };
const actionBar: React.CSSProperties = { padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 8 };
