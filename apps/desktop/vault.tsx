import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { tokens } from '@ui/design-system/tokens';
import { useTheme } from '@ui/contexts/ThemeContext';
import { useDebounce } from '@ui/contexts/useDebounce';
import { useKeyboard } from '@ui/contexts/useKeyboard';
import { PasswordGenerator, PasswordStrengthMeter } from '@ui/components/molecules';
import { Button, Badge } from '@ui/components/atoms';
import { Modal } from '@ui/components/organisms';
import { useToast } from '@ui/components/organisms';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { VaultItem, VaultItemType, VaultData } from '@core/vault/types';
import { searchItems, addItem, updateItem, deleteItem, restoreItem, emptyTrash, addAttachment } from '@core/vault/storage';
import { exportVault } from '@core/vault/storage';
import { parseBitwardenCsv, parseChromeCsv, parseGenericCsv, importItems } from '@core/vault/import';
import { formatDate } from '@shared/utils';
import { shareItem, revokeSharing, getActiveShares } from '@core/sharing/service';
import { generateTOTP, getTOTPRemainingSeconds } from '@core/vault/totp';
import { createAuditLog } from '@core/audit/logger';
import { CLIPBOARD_CLEAR_MS } from '@shared/constants';
import { VaultItemDialog, emptyForm, itemToForm } from './VaultItemDialog';
import { FolderPane } from './FolderPane';
import type { FormData } from './VaultItemDialog';

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<VaultItemType, string> = {
  password: '#4f98a3',
  card: '#fdab43',
  note: '#9b7de8',
  identity: '#6daa45',
  totp: '#e87da0',
  passkey: '#63b3ff',
};

const TYPE_LABEL: Record<VaultItemType, string> = {
  password: 'Senha',
  card: 'Cartão',
  note: 'Nota',
  identity: 'Identidade',
  totp: 'TOTP',
  passkey: 'Passkey',
};

const TYPE_BADGE_VARIANT: Record<VaultItemType, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  password: 'info',
  card: 'warning',
  note: 'default',
  identity: 'success',
  totp: 'error',
  passkey: 'info',
};

type FilterType = VaultItemType | 'all' | 'favorites' | 'folders' | 'trash';

// ─── Form ─────────────────────────────────────────────────────────────────────

function itemSubtitle(item: VaultItem): string {
  switch (item.type) {
    case 'password': return item.username || item.url || '—';
    case 'totp': return item.username || item.url || 'Autenticador';
    case 'card': return item.card?.number ? `•••• ${item.card.number.replace(/\s/g, '').slice(-4)}` : 'Cartão';
    case 'note': return item.note ? item.note.slice(0, 50) : 'Nota vazia';
    case 'identity': return item.identity ? `${item.identity.firstName} ${item.identity.lastName}`.trim() : 'Identidade';
    case 'passkey': return item.passkey?.provider ?? 'Passkey';
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface VaultScreenProps {
  vault: VaultData;
  onVaultChange: (vault: VaultData) => void;
  masterPassword: string;
  onLogout: () => void;
}

// ─── VaultScreen ──────────────────────────────────────────────────────────────

export const VaultScreen: React.FC<VaultScreenProps> = ({
  vault, onVaultChange, masterPassword, onLogout,
}) => {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [shareUserId, setShareUserId] = useState('');
  const [sharePermission, setSharePermission] = useState<'read' | 'write' | 'admin'>('read');
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [importFormat, setImportFormat] = useState<'bitwarden' | 'chrome' | 'generic'>('generic');
  const [exportPassword, setExportPassword] = useState('');
  const { addToast } = useToast();
  const { theme, toggle: toggleTheme, tokens } = useTheme();

  useKeyboard([
    { key: 'f', ctrl: true, handler: () => { setFilter('all'); searchRef.current?.focus(); } },
    { key: 'n', ctrl: true, handler: () => { openAddModal(); } },
    { key: 'Escape', handler: () => { if (selectedItem) setSelectedItem(null); } },
  ]);

  const filtered = useMemo(() => {
    if (filter === 'trash') return [] as VaultItem[];
    let items = searchItems(vault, debouncedSearch);
    if (filter === 'favorites') items = items.filter(i => i.favorite);
    else if (filter !== 'all') items = items.filter(i => i.type === filter);
    return items;
  }, [vault, debouncedSearch, filter]);

  // Keep selectedItem in sync with vault updates
  useEffect(() => {
    if (selectedItem) {
      const updated = vault.items.find(i => i.id === selectedItem.id);
      setSelectedItem(updated ?? null);
    }
  }, [vault.items]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Modal openers ────────────────────────────────────────────────────────────

  const openAddModal = useCallback(() => {
    setEditingItem(null);
    setForm(emptyForm());
    setShowAddModal(true);
  }, []);

  const openEditModal = useCallback((item: VaultItem) => {
    setEditingItem(item);
    setForm(itemToForm(item));
    setShowAddModal(true);
  }, []);

  const closeAddModal = useCallback(() => {
    setShowAddModal(false);
    setEditingItem(null);
    setForm(emptyForm());
  }, []);

  // ── Clipboard ────────────────────────────────────────────────────────────────

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await writeText(text);
      addToast({ type: 'info', title: `${label} copiado!` });
      setTimeout(() => writeText('').catch(() => {}), CLIPBOARD_CLEAR_MS);
    } catch {
      addToast({ type: 'error', title: 'Falha ao copiar' });
    }
  }, [addToast]);

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!form.title.trim()) { addToast({ type: 'error', title: 'Título obrigatório' }); return; }
    if (form.type === 'password' && !form.password) { addToast({ type: 'error', title: 'Senha obrigatória' }); return; }
    if (form.type === 'totp' && !form.totpSeed) { addToast({ type: 'error', title: 'Semente TOTP obrigatória' }); return; }

    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
    const isEdit = editingItem !== null;

    const props: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'> = {
      type: form.type,
      title: form.title.trim(),
      url: form.url || undefined,
      username: form.username || undefined,
      password: form.type === 'password' ? (form.password || undefined) : undefined,
      totpSeed: form.type === 'totp' ? (form.totpSeed || undefined) : undefined,
      note: form.type === 'note' ? (form.note || undefined) : undefined,
      card: form.type === 'card' ? { number: form.card.number, expiry: form.card.expiry, cvc: form.card.cvc, cardholder: form.card.cardholder, brand: form.card.brand || undefined } : undefined,
      identity: form.type === 'identity' ? { firstName: form.identity.firstName, lastName: form.identity.lastName, email: form.identity.email, phone: form.identity.phone || undefined, address: form.identity.address || undefined, document: form.identity.document || undefined } : undefined,
      tags, favorite: form.favorite,
      ownerId: 'local',
      collectionIds: editingItem?.collectionIds ?? [],
      sharedWith: editingItem?.sharedWith ?? [],
    };

    let newVault = isEdit ? updateItem(vault, editingItem.id, props) : addItem(vault, props);
    const audit = createAuditLog({ orgId: 'local', userId: 'local', action: isEdit ? 'item_updated' : 'item_created', targetId: editingItem?.id, details: { title: form.title.trim(), type: form.type } });
    newVault = { ...newVault, auditLogs: [...newVault.auditLogs, audit] };
    onVaultChange(newVault);

    if (!isEdit) setSelectedItem(null);
    closeAddModal();
    addToast({ type: 'success', title: isEdit ? 'Item atualizado!' : 'Item criado!' });
  }, [form, editingItem, vault, onVaultChange, addToast, closeAddModal]);

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = useCallback((itemId: string) => {
    const item = vault.items.find(i => i.id === itemId);
    let newVault = deleteItem(vault, itemId);
    const audit = createAuditLog({ orgId: 'local', userId: 'local', action: 'item_deleted', targetId: itemId, details: { title: item?.title ?? '' } });
    newVault = { ...newVault, auditLogs: [...newVault.auditLogs, audit] };
    onVaultChange(newVault);
    if (selectedItem?.id === itemId) setSelectedItem(null);
    addToast({ type: 'info', title: 'Item removido' });
  }, [vault, selectedItem, onVaultChange, addToast]);

  // ── Share ────────────────────────────────────────────────────────────────────

  const handleShare = useCallback(() => {
    if (!selectedItem || !shareUserId.trim()) return;
    const updated = shareItem(selectedItem, shareUserId.trim(), sharePermission);
    let newVault = { ...vault, items: vault.items.map(i => i.id === selectedItem.id ? updated : i) };
    const audit = createAuditLog({ orgId: 'local', userId: 'local', action: 'item_shared', targetId: selectedItem.id, details: { sharedWith: shareUserId.trim(), permissions: sharePermission } });
    newVault = { ...newVault, auditLogs: [...newVault.auditLogs, audit] };
    onVaultChange(newVault);
    setShareUserId('');
    setShowShareModal(false);
    addToast({ type: 'success', title: `Compartilhado com ${shareUserId.trim()}` });
  }, [selectedItem, shareUserId, sharePermission, vault, onVaultChange, addToast]);

  // ── Toggle favorite ──────────────────────────────────────────────────────────

  const handleToggleFavorite = useCallback((itemId: string) => {
    const item = vault.items.find(i => i.id === itemId);
    if (!item) return;
    const newVault = updateItem(vault, itemId, { favorite: !item.favorite });
    onVaultChange(newVault);
  }, [vault, onVaultChange]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render — 3-pane layout
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{ display: 'flex', height: '100vh', background: 'var(--bg-app)', overflow: 'hidden' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleAttachDrop(e, vault, onVaultChange, selectedItem?.id ?? null, addToast, masterPassword).catch(() => {}); }}
    >
      {dragOver && <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(79,152,163,0.08)',
        border: '3px dashed rgba(79,152,163,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: 16, fontWeight: 600, color: 'rgba(79,152,163,0.6)' }}>
          Solte para anexar ao item selecionado
        </span>
      </div>}
      {/* ══ PANE 1 — Sidebar ══════════════════════════════════════════════════ */}
      <div style={{
        width: sidebarCollapsed ? 56 : 220,
        flexShrink: 0,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-dim)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        overflow: 'hidden',
        transition: 'width 0.2s',
      }}>

        {/* ── Logo ── */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {sidebarCollapsed ? (
            <button onClick={() => setSidebarCollapsed(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.colors.neutral6, padding: 4, flexShrink: 0 }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          ) : (
            <>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(79,152,163,0.18) 0%, rgba(155,125,232,0.12) 100%)',
                border: '1px solid rgba(79,152,163,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 18px rgba(79,152,163,0.12)',
              }}>
                <LockIcon size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: tokens.typography.fontFamily,
                  fontSize: '13px', fontWeight: 800, letterSpacing: '0.08em',
                  background: 'linear-gradient(135deg, #4f98a3 0%, #9b7de8 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                  lineHeight: 1,
                }}>LOCKPIN</div>
                <div style={{
                  fontFamily: tokens.typography.fontFamily, fontSize: '10px',
                  color: 'rgba(79,152,163,0.5)', marginTop: 3, letterSpacing: '0.02em',
                }}>Vault desbloqueado</div>
              </div>
              <button onClick={() => setSidebarCollapsed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.colors.neutral6, padding: 4, flexShrink: 0 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </>
          )}
        </div>

        {/* ── Nav ── */}
        <nav style={{ flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
          <NavBtn label="Todos" count={vault.items.length} active={filter === 'all'} onClick={() => setFilter('all')}>
            <GridIcon />
          </NavBtn>
          <NavBtn label="Favoritos" count={vault.items.filter(i => i.favorite).length} active={filter === 'favorites'} onClick={() => setFilter('favorites')} color="#fdab43">
            <StarIcon />
          </NavBtn>

          {!sidebarCollapsed && <SidebarLabel>Categorias</SidebarLabel>}

          <NavBtn label="Senhas" count={vault.items.filter(i => i.type === 'password').length} active={filter === 'password'} onClick={() => setFilter('password')} color={TYPE_COLOR.password} compact={sidebarCollapsed}>
            <KeyIcon />
          </NavBtn>
          <NavBtn label="TOTP" count={vault.items.filter(i => i.type === 'totp').length} active={filter === 'totp'} onClick={() => setFilter('totp')} color={TYPE_COLOR.totp} compact={sidebarCollapsed}>
            <ShieldClockIcon />
          </NavBtn>
          <NavBtn label="Cartões" count={vault.items.filter(i => i.type === 'card').length} active={filter === 'card'} onClick={() => setFilter('card')} color={TYPE_COLOR.card} compact={sidebarCollapsed}>
            <CardIcon />
          </NavBtn>
          <NavBtn label="Notas" count={vault.items.filter(i => i.type === 'note').length} active={filter === 'note'} onClick={() => setFilter('note')} color={TYPE_COLOR.note} compact={sidebarCollapsed}>
            <NoteIcon />
          </NavBtn>
          <NavBtn label="Identidades" count={vault.items.filter(i => i.type === 'identity').length} active={filter === 'identity'} onClick={() => setFilter('identity')} color={TYPE_COLOR.identity} compact={sidebarCollapsed}>
            <PersonIcon />
          </NavBtn>

          {!sidebarCollapsed && <SidebarLabel>Armazenamento</SidebarLabel>}

          <NavBtn label="Pastas Seguras" count={vault.folders?.length ?? 0} active={filter === 'folders'} onClick={() => setFilter('folders')} color="#fdab43" compact={sidebarCollapsed}>
            <SidebarFolderIcon />
          </NavBtn>

          {!sidebarCollapsed && <SidebarLabel>Ferramentas</SidebarLabel>}

          <NavBtn label="Gerador" active={false} onClick={() => setShowGenerator(true)} color="#9b7de8" compact={sidebarCollapsed}>
            <WandIcon />
          </NavBtn>
          <NavBtn label="Importar CSV" active={false} onClick={() => setShowImport(true)} color="#6daa45" compact={sidebarCollapsed}>
            <ImportIcon />
          </NavBtn>
          <NavBtn label="Exportar" active={false} onClick={() => setShowExport(true)} color="#fdab43" compact={sidebarCollapsed}>
            <ExportIcon />
          </NavBtn>
          <NavBtn label="Lixeira" count={vault.trash?.length ?? 0} active={filter === 'trash'} onClick={() => setFilter(filter === 'trash' ? 'all' : 'trash')} color="#e87da0" compact={sidebarCollapsed}>
            <TrashIcon />
          </NavBtn>
          <NavBtn label="Novo item" active={false} onClick={openAddModal} color="#4f98a3" compact={sidebarCollapsed}>
            <PlusIcon />
          </NavBtn>
        </nav>

        {/* ── Profile ── */}
        <div style={{ padding: '10px 8px 12px', borderTop: '1px solid var(--border-dim)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 12,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-dim)',
          }}>
            {/* Avatar */}
            <div style={{
              width: 32, height: 32, borderRadius: 9, flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(79,152,163,0.25) 0%, rgba(155,125,232,0.18) 100%)',
              border: '1px solid rgba(79,152,163,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 12px rgba(79,152,163,0.08)',
            }}>
              <LockIcon size={14} />
            </div>
            {/* Info */}
            {!sidebarCollapsed && <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: tokens.typography.fontFamily, fontSize: '12px', fontWeight: 500,
                color: tokens.colors.neutral9,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                Vault Local
              </div>
              <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: 'rgba(109,170,69,0.65)', marginTop: 2, letterSpacing: '0.02em' }}>
                Local · Encriptado
              </div>
            </div>}
            {/* Theme toggle */}
            <button onClick={toggleTheme} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border-medium)',
              borderRadius: 7, padding: 6, cursor: 'pointer', color: tokens.colors.neutral7,
              display: 'flex', transition: 'all 0.15s', flexShrink: 0,
            }}>
              {theme === 'dark'
                ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx={12} cy={12} r={5} /><line x1={12} y1={1} x2={12} y2={3} /><line x1={12} y1={21} x2={12} y2={23} /><line x1={4.22} y1={4.22} x2={5.64} y2={5.64} /><line x1={18.36} y1={18.36} x2={19.78} y2={19.78} /><line x1={1} y1={12} x2={3} y2={12} /><line x1={21} y1={12} x2={23} y2={12} /><line x1={4.22} y1={19.78} x2={5.64} y2={18.36} /><line x1={18.36} y1={5.64} x2={19.78} y2={4.22} /></svg>
                : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
              }
            </button>
            {/* Logout */}
            <LogoutButton onLogout={onLogout} />
          </div>
        </div>
      </div>

      {filter === 'folders' ? (
        /* ══ FOLDER MODE — replaces panes 2 & 3 ════════════════════════════ */
        <FolderPane
          folders={vault.folders ?? []}
          onChange={newFolders => onVaultChange({ ...vault, folders: newFolders })}
        />
      ) : filter === 'trash' ? (
        /* ══ TRASH VIEW ════════════════════════════════════════════════════ */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 24, overflowY: 'auto', background: 'var(--bg-detail)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontFamily: tokens.typography.fontFamily, fontSize: '18px', fontWeight: 700, color: tokens.colors.neutral12, margin: 0 }}>
              Lixeira ({vault.trash?.length ?? 0})
            </h2>
            {(vault.trash?.length ?? 0) > 0 && (
              <Button variant="danger" onClick={async () => { const v = await emptyTrash(vault); onVaultChange(v); addToast({ type: 'info', title: 'Lixeira esvaziada' }); }}>
                Esvaziar Lixeira
              </Button>
            )}
          </div>
          {(vault.trash?.length ?? 0) === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '14px', color: tokens.colors.neutral6 }}>Lixeira vazia</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vault.trash.map(d => (
                <div key={d.item.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', background: 'var(--bg-surface)',
                  border: '1px solid var(--border-dim)', borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ opacity: 0.5 }}>
                      <TypeIcon type={d.item.type} size={16} color={TYPE_COLOR[d.item.type]} />
                    </div>
                    <div>
                      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 600, color: tokens.colors.neutral10, margin: 0 }}>
                        {d.item.title}
                      </p>
                      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral6, margin: 0 }}>
                        Excluído em {formatDate(d.deletedAt)}
                      </p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => { onVaultChange(restoreItem(vault, d.item.id)); addToast({ type: 'success', title: 'Item restaurado' }); }}>
                    Restaurar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ══ PANE 2 — Item List ══════════════════════════════════════════ */}
          <div style={{
            width: 296, flexShrink: 0, background: 'var(--bg-list)',
            borderRight: '1px solid var(--border-dim)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid var(--border-dim)' }}>
              <SearchField value={search} onChange={setSearch} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral6 }}>
                  {filtered.length} {filtered.length === 1 ? 'item' : 'itens'}
                </span>
                <button
                  onClick={openAddModal}
                  style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(79,152,163,0.15)', border: '1px solid rgba(79,152,163,0.3)', color: '#4f98a3', fontFamily: tokens.typography.fontFamily, fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(79,152,163,0.28)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(79,152,163,0.15)'; }}
                >
                  + Novo
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
              {filtered.length === 0 ? (
                <div style={{ paddingTop: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.2 }}>{search ? '🔍' : '🔒'}</div>
                  <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral7 }}>
                    {search ? 'Nenhum resultado' : 'Vault vazio'}
                  </p>
                  {!search && (
                    <button onClick={openAddModal} style={{ marginTop: 12, padding: '6px 14px', borderRadius: 8, background: 'rgba(79,152,163,0.15)', border: '1px solid rgba(79,152,163,0.2)', color: '#4f98a3', fontFamily: tokens.typography.fontFamily, fontSize: '12px', cursor: 'pointer' }}>
                      Adicionar item
                    </button>
                  )}
                </div>
              ) : (
                filtered.map(item => (
                  <ItemCard
                    key={item.id} item={item}
                    selected={selectedItem?.id === item.id}
                    onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
                    onToggleFavorite={(e) => { e.stopPropagation(); handleToggleFavorite(item.id); }}
                  />
                ))
              )}
            </div>
          </div>

          {/* ══ PANE 3 — Detail ═════════════════════════════════════════════ */}
          <div style={{ flex: 1, background: 'var(--bg-detail)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {!selectedItem ? (
              <EmptyDetailPane vault={vault} onAddNew={openAddModal} />
            ) : (
              <ItemDetailPane
                item={selectedItem} vault={vault} userId="local"
                masterPassword={masterPassword}
                onEdit={() => openEditModal(selectedItem)}
                onDelete={() => handleDelete(selectedItem.id)}
                onShare={() => setShowShareModal(true)}
                onCopy={copy}
                onToggleFavorite={() => handleToggleFavorite(selectedItem.id)}
                onVaultChange={onVaultChange}
                onRevokeShare={(targetUserId) => {
                  const updated = revokeSharing(selectedItem, targetUserId);
                  const audit = createAuditLog({ orgId: 'local', userId: 'local', action: 'share_revoked', targetId: selectedItem.id, details: { revokedUserId: targetUserId } });
                  const newVault = { ...vault, items: vault.items.map(i => i.id === selectedItem.id ? updated : i), auditLogs: [...vault.auditLogs, audit] };
                  onVaultChange(newVault);
                }}
              />
            )}
          </div>
        </>
      )}

      {/* ══ Dialogs ══════════════════════════════════════════════════════════════ */}

      {/* Item add / edit */}
      <VaultItemDialog
        open={showAddModal}
        form={form}
        onChange={setForm}
        editingItem={editingItem}
        onSave={handleSave}
        onClose={closeAddModal}
      />

      {/* Share */}
      <Modal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        title={`Compartilhar — "${selectedItem?.title}"`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowShareModal(false)}>Cancelar</Button>
            <Button onClick={handleShare} disabled={!shareUserId.trim()}>Compartilhar</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ShareField label="Usuário / Email" value={shareUserId} onChange={setShareUserId} placeholder="user@email.com" autoFocus />
          <div>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Permissão</p>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['read', 'write', 'admin'] as const).map(p => (
                <button key={p} onClick={() => setSharePermission(p)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${sharePermission === p ? 'rgba(79,152,163,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  background: sharePermission === p ? 'rgba(79,152,163,0.12)' : 'rgba(255,255,255,0.03)',
                  color: sharePermission === p ? '#4f98a3' : tokens.colors.neutral7,
                  fontFamily: tokens.typography.fontFamily, fontSize: '12px', fontWeight: sharePermission === p ? 600 : 400,
                  transition: 'all 0.13s',
                }}>
                  {p === 'read' ? 'Leitura' : p === 'write' ? 'Escrita' : 'Admin'}
                </button>
              ))}
            </div>
          </div>
          {selectedItem && getActiveShares(selectedItem).length > 0 && (
            <div>
              <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Compartilhado com
              </p>
              {getActiveShares(selectedItem).map(s => (
                <div key={s.userId} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 4,
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral9 }}>
                    {s.userId} · <span style={{ color: tokens.colors.neutral6 }}>{s.permissions}</span>
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => {
                    if (!selectedItem) return;
                    const updated = revokeSharing(selectedItem, s.userId);
                    const newVault = { ...vault, items: vault.items.map(i => i.id === selectedItem.id ? updated : i) };
                    onVaultChange(newVault);
                  }}>
                    Revogar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Standalone Generator (sidebar button) */}
      <Modal open={showGenerator} onClose={() => setShowGenerator(false)} title="Gerador de Senhas" size="sm">
        <PasswordGenerator onPasswordGenerated={pwd => {
          setForm(f => ({ ...f, password: pwd, type: 'password' }));
          setShowGenerator(false);
          setShowAddModal(true);
        }} />
      </Modal>

      {/* Import CSV */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Importar CSV" size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 0 16px' }}>
          <div>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Formato</p>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['bitwarden', 'chrome', 'generic'] as const).map(f => (
                <button key={f} onClick={() => setImportFormat(f)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${importFormat === f ? 'rgba(79,152,163,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  background: importFormat === f ? 'rgba(79,152,163,0.12)' : 'rgba(255,255,255,0.03)',
                  color: importFormat === f ? '#4f98a3' : tokens.colors.neutral7,
                  fontFamily: tokens.typography.fontFamily, fontSize: '12px', fontWeight: importFormat === f ? 600 : 400,
                }}>
                  {f === 'bitwarden' ? 'Bitwarden' : f === 'chrome' ? 'Chrome' : 'Genérico'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Cole o CSV</p>
            <textarea
              value={importCsv}
              onChange={e => setImportCsv(e.target.value)}
              rows={6}
              placeholder="Cole o conteúdo CSV aqui..."
              style={{
                width: '100%', padding: '10px 12px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10, color: '#f0f0f0', fontFamily: tokens.typography.fontFamilyMono,
                fontSize: '12px', outline: 'none', resize: 'vertical',
              }}
            />
          </div>
          <Button onClick={() => {
            if (!importCsv.trim()) { addToast({ type: 'error', title: 'Cole o CSV primeiro' }); return; }
            const parser = importFormat === 'bitwarden' ? parseBitwardenCsv : importFormat === 'chrome' ? parseChromeCsv : parseGenericCsv;
            const parsed = parser(importCsv);
            if (parsed.length === 0) { addToast({ type: 'error', title: 'Nenhum item encontrado' }); return; }
            const newVault = importItems(vault, parsed);
            onVaultChange(newVault);
            setImportCsv('');
            setShowImport(false);
            addToast({ type: 'success', title: `${parsed.length} item(ns) importados!` });
          }} disabled={!importCsv.trim()}>
            Importar
          </Button>
        </div>
      </Modal>

      {/* Export Vault */}
      <Modal open={showExport} onClose={() => setShowExport(false)} title="Exportar Vault" size="sm">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 0 16px' }}>
          <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral8, lineHeight: 1.5 }}>
            Defina uma senha para exportar o vault. O arquivo será criptografado com AES-256-GCM.
          </p>
          <div>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Senha de exportação</p>
            <input
              type="password" value={exportPassword}
              onChange={e => setExportPassword(e.target.value)}
              placeholder="Senha para o arquivo exportado"
              style={{
                width: '100%', padding: '9px 12px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 9, color: '#f0f0f0', outline: 'none',
                fontFamily: tokens.typography.fontFamily, fontSize: '13px',
              }}
            />
          </div>
          <Button onClick={async () => {
            if (!exportPassword) { addToast({ type: 'error', title: 'Defina uma senha' }); return; }
            try {
              const data = await exportVault(vault, exportPassword);
              const blob = new Blob([data], { type: 'application/octet-stream' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `lockpin-export-${Date.now()}.enc`;
              a.click();
              URL.revokeObjectURL(url);
              setExportPassword('');
              setShowExport(false);
              addToast({ type: 'success', title: 'Vault exportado!' });
            } catch { addToast({ type: 'error', title: 'Falha ao exportar' }); }
          }} disabled={!exportPassword}>
            Exportar
          </Button>
        </div>
      </Modal>
    </div>
  );
};

function ShareField({ label, value, onChange, placeholder, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>{label}</p>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus}
        style={{
          width: '100%', padding: '9px 12px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 9, color: '#f0f0f0', outline: 'none',
          fontFamily: tokens.typography.fontFamily, fontSize: '13px', transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(79,152,163,0.5)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
      />
    </div>
  );
}

async function handleAttachDrop(e: React.DragEvent, vault: VaultData, onVaultChange: (v: VaultData) => void, selectedId: string | null, addToast: (t: { type: 'success' | 'error' | 'warning' | 'info'; title: string }) => void, masterPassword?: string) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;
  if (!selectedId) { addToast?.({ type: 'error', title: 'Selecione um item para anexar arquivos' }); return; }
  let updated = vault;
  for (const file of files) {
    updated = await addAttachment(updated, selectedId, file, masterPassword);
  }
  onVaultChange(updated);
  addToast?.({ type: 'success', title: `${files.length} anexo(s) adicionado(s)` });
}

// ─── EmptyDetailPane ──────────────────────────────────────────────────────────

function EmptyDetailPane({ vault, onAddNew }: { vault: VaultData; onAddNew: () => void }) {
  const { tokens } = useTheme();
  const counts = Object.entries({
    password: vault.items.filter(i => i.type === 'password').length,
    totp: vault.items.filter(i => i.type === 'totp').length,
    card: vault.items.filter(i => i.type === 'card').length,
    note: vault.items.filter(i => i.type === 'note').length,
    identity: vault.items.filter(i => i.type === 'identity').length,
  } as Record<VaultItemType, number>).filter(([, v]) => v > 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', gap: 28 }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: 'rgba(79,152,163,0.08)',
        border: '1px solid rgba(79,152,163,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 32px rgba(79,152,163,0.08)',
      }}>
        <LockIcon size={30} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '16px', fontWeight: 600, color: tokens.colors.neutral8, marginBottom: 6 }}>
          Selecione um item
        </p>
        <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral6 }}>
          Os detalhes aparecerão aqui
        </p>
      </div>

      {counts.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, width: '100%', maxWidth: 380 }}>
          {counts.map(([type, count]) => (
            <div key={type} style={{
              padding: '14px 12px', textAlign: 'center',
              background: `${TYPE_COLOR[type as VaultItemType]}08`,
              border: `1px solid ${TYPE_COLOR[type as VaultItemType]}18`,
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                <TypeIcon type={type as VaultItemType} size={16} color={TYPE_COLOR[type as VaultItemType]} />
              </div>
              <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '20px', fontWeight: 700, color: tokens.colors.neutral11, lineHeight: 1 }}>{count}</div>
              <div style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: tokens.colors.neutral6, marginTop: 4 }}>{TYPE_LABEL[type as VaultItemType]}</div>
            </div>
          ))}
        </div>
      ) : (
        <button onClick={onAddNew} style={{
          padding: '10px 20px', borderRadius: 10,
          background: 'rgba(79,152,163,0.15)', border: '1px solid rgba(79,152,163,0.25)',
          color: '#4f98a3', fontFamily: tokens.typography.fontFamily, fontSize: '13px',
          fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
        }}>
          Adicionar primeiro item
        </button>
      )}
    </div>
  );
}

// ─── ItemDetailPane ───────────────────────────────────────────────────────────

interface ItemDetailPaneProps {
  item: VaultItem;
  vault: VaultData;
  userId: string;
  masterPassword: string;
  onEdit: () => void;
  onDelete: () => void;
  onShare: () => void;
  onCopy: (text: string, label: string) => void;
  onToggleFavorite: () => void;
  onRevokeShare: (targetUserId: string) => void;
  onVaultChange: (vault: VaultData) => void;
}

function ItemDetailPane({ item, onEdit, onDelete, onShare, onCopy, onToggleFavorite, vault, masterPassword, onVaultChange }: ItemDetailPaneProps) {
  const { tokens } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', animation: 'slide-in 0.18s ease' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-dim)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: `${TYPE_COLOR[item.type]}15`,
              border: `1px solid ${TYPE_COLOR[item.type]}25`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 20px ${TYPE_COLOR[item.type]}15`,
              flexShrink: 0,
            }}>
              <TypeIcon type={item.type} size={22} color={TYPE_COLOR[item.type]} />
            </div>
            <div>
              <h2 style={{ fontFamily: tokens.typography.fontFamily, fontSize: '18px', fontWeight: 700, color: tokens.colors.neutral12, lineHeight: 1.2 }}>
                {item.title}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <Badge variant={TYPE_BADGE_VARIANT[item.type]}>{TYPE_LABEL[item.type]}</Badge>
                <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral6 }}>
                  {formatDate(item.updatedAt)}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onToggleFavorite} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 6,
            fontSize: 20, color: item.favorite ? '#fdab43' : 'rgba(255,255,255,0.15)',
            transition: 'color 0.15s', flexShrink: 0,
          }}>
            {item.favorite ? '★' : '☆'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* Password */}
        {item.type === 'password' && (
          <Section>
            {item.url && <DetailRow label="URL">
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4f98a3', fontFamily: tokens.typography.fontFamily, fontSize: '13px', wordBreak: 'break-all' }}>
                {item.url}
              </a>
            </DetailRow>}
            {item.username && <SecretField label="Usuário" value={item.username} onCopy={onCopy} />}
            {item.password && <>
              <SecretField label="Senha" value={item.password} masked onCopy={onCopy} />
              <div style={{ marginTop: 8 }}>
                <PasswordStrengthMeter password={item.password} />
              </div>
            </>}
          </Section>
        )}

        {/* TOTP */}
        {item.type === 'totp' && item.totpSeed && (
          <Section>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral6, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Código atual
              </p>
              <TOTPDisplay seed={item.totpSeed} onCopy={code => onCopy(code, 'Código TOTP')} />
            </div>
            {item.username && <SecretField label="Usuário" value={item.username} onCopy={onCopy} />}
            {item.url && <DetailRow label="URL">
              <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral9 }}>{item.url}</span>
            </DetailRow>}
          </Section>
        )}

        {/* Card */}
        {item.type === 'card' && item.card && (
          <Section>
            <SecretField label="Titular" value={item.card.cardholder} onCopy={onCopy} />
            <SecretField label="Número" value={item.card.number} masked maskFn={v => `•••• •••• •••• ${v.replace(/\s/g, '').slice(-4)}`} onCopy={onCopy} />
            <div style={{ display: 'flex', gap: 16 }}>
              <SecretField label="Validade" value={item.card.expiry} onCopy={onCopy} />
              <SecretField label="CVC" value={item.card.cvc} masked onCopy={onCopy} />
            </div>
          </Section>
        )}

        {/* Note */}
        {item.type === 'note' && (
          <Section>
            <div style={{
              padding: '14px 16px',
              background: 'rgba(155,125,232,0.05)',
              border: '1px solid rgba(155,125,232,0.12)',
              borderRadius: 12,
              fontFamily: tokens.typography.fontFamily,
              fontSize: '13px',
              color: tokens.colors.neutral10,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.7,
              maxHeight: 320,
              overflowY: 'auto',
            }}>
              {item.note || <em style={{ color: tokens.colors.neutral6 }}>Nota vazia</em>}
            </div>
          </Section>
        )}

        {/* Identity */}
        {item.type === 'identity' && item.identity && (
          <Section>
            <SecretField label="Nome completo" value={`${item.identity.firstName} ${item.identity.lastName}`.trim()} onCopy={onCopy} />
            {item.identity.email && <SecretField label="Email" value={item.identity.email} onCopy={onCopy} />}
            {item.identity.phone && <SecretField label="Telefone" value={item.identity.phone} onCopy={onCopy} />}
            {item.identity.document && <SecretField label="Documento" value={item.identity.document} masked onCopy={onCopy} />}
            {item.identity.address && <DetailRow label="Endereço">
              <span style={{ fontFamily: tokens.typography.fontFamily, fontSize: '13px', color: tokens.colors.neutral9 }}>{item.identity.address}</span>
            </DetailRow>}
          </Section>
        )}

        {/* Passkey */}
        {item.type === 'passkey' && item.passkey && (
          <Section>
            <SecretField label="Provider" value={item.passkey.provider} onCopy={onCopy} />
            <SecretField label="Credential ID" value={item.passkey.credentialId} masked onCopy={onCopy} />
          </Section>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral6, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Tags
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {item.tags.map(tag => (
                <span key={tag} style={{
                  fontFamily: tokens.typography.fontFamily, fontSize: '11px',
                  color: tokens.colors.neutral8, background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: '3px 10px', borderRadius: 20,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Attachments */}
        {(item.attachments?.length ?? 0) > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral6, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Anexos ({item.attachments!.length})
            </p>
            {item.attachments!.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', marginBottom: 4,
                background: 'rgba(79,152,163,0.05)', border: '1px solid rgba(79,152,163,0.12)',
                borderRadius: 8,
              }}>
                <div>
                  <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral10, margin: 0 }}>{a.name}</p>
                  <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: tokens.colors.neutral6, margin: 0 }}>{(a.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border-dim)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <MetaField label="Criado" value={formatDate(item.createdAt)} />
            <MetaField label="Atualizado" value={formatDate(item.updatedAt)} />
            <MetaField label="Compartilhado" value={`${getActiveShares(item).length} usuário(s)`} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-dim)', display: 'flex', gap: 8 }}>
        <Button variant="secondary" onClick={onEdit}>Editar</Button>
        <Button variant="secondary" onClick={onShare}>Compartilhar</Button>
        <AttachButton item={item} vault={vault} masterPassword={masterPassword} onVaultChange={onVaultChange} />
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="danger" onClick={onDelete}>Excluir</Button>
        </div>
      </div>
    </div>
  );
}

// ─── TOTPDisplay ──────────────────────────────────────────────────────────────

const TOTPDisplay: React.FC<{ seed: string; onCopy: (code: string) => void }> = ({ seed, onCopy }) => {
  const [code, setCode] = useState('------');
  const [remaining, setRemaining] = useState(30);

  useEffect(() => {
    let mounted = true;
    const update = async () => {
      if (!mounted) return;
      try {
        const c = await generateTOTP(seed, Date.now());
        const r = getTOTPRemainingSeconds();
        if (mounted) { setCode(c); setRemaining(r); }
      } catch { /* invalid seed */ }
    };
    update();
    const id = setInterval(update, 1000);
    return () => { mounted = false; clearInterval(id); };
  }, [seed]);

  const pct = remaining / 30;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const ringColor = remaining <= 5 ? '#e87da0' : remaining <= 10 ? '#fdab43' : '#6daa45';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div>
        <span style={{
          fontFamily: tokens.typography.fontFamilyMono,
          fontSize: '36px',
          fontWeight: 700,
          color: tokens.colors.neutral12,
          letterSpacing: '0.25em',
          display: 'block',
          lineHeight: 1,
        }}>
          {code.slice(0, 3)} {code.slice(3)}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <svg width={48} height={48} viewBox="0 0 48 48">
          <circle cx={24} cy={24} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
          <circle
            cx={24} cy={24} r={r} fill="none"
            stroke={ringColor} strokeWidth={3}
            strokeDasharray={`${circ}`}
            strokeDashoffset={`${circ * (1 - pct)}`}
            strokeLinecap="round"
            transform="rotate(-90 24 24)"
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
          />
          <text x={24} y={28} textAnchor="middle" fill={ringColor}
            style={{ fontFamily: tokens.typography.fontFamilyMono, fontSize: '11px', fontWeight: 600 }}>
            {remaining}
          </text>
        </svg>
        <button onClick={() => onCopy(code)} style={{
          padding: '4px 12px', borderRadius: 6,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          color: tokens.colors.neutral9, fontFamily: tokens.typography.fontFamily, fontSize: '11px',
          cursor: 'pointer', transition: 'all 0.15s',
        }}>
          Copiar
        </button>
      </div>
    </div>
  );
};

// ─── ItemCard (list) ──────────────────────────────────────────────────────────

function ItemCard({ item, selected, onClick, onToggleFavorite }: {
  item: VaultItem;
  selected: boolean;
  onClick: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { tokens } = useTheme();

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 10px 10px 12px',
        borderRadius: 10,
        cursor: 'pointer',
        background: selected ? `${TYPE_COLOR[item.type]}12` : hovered ? 'var(--bg-surface-hover)' : 'transparent',
        border: `1px solid ${selected ? `${TYPE_COLOR[item.type]}35` : 'transparent'}`,
        borderLeft: `3px solid ${selected ? TYPE_COLOR[item.type] : hovered ? 'var(--border-strong)' : 'var(--border-dim)'}`,
        marginBottom: 3,
        transition: 'all 0.13s',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {/* Icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: `${TYPE_COLOR[item.type]}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <TypeIcon type={item.type} size={15} color={TYPE_COLOR[item.type]} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: tokens.typography.fontFamily, fontSize: '13px', fontWeight: 600,
          color: tokens.colors.neutral11,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title}
        </div>
        <div style={{
          fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral7,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1,
        }}>
          {itemSubtitle(item)}
        </div>
      </div>

      {/* Favorite star */}
      <span onClick={onToggleFavorite} style={{
        fontSize: 13, cursor: 'pointer',
        color: item.favorite ? '#fdab43' : tokens.colors.neutral5,
        flexShrink: 0, transition: 'color 0.15s',
      }}>
        {item.favorite ? '★' : '☆'}
      </span>
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '11px', color: tokens.colors.neutral7, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function partialMask(val: string): string {
  if (val.includes('@')) {
    const [local, domain] = val.split('@');
    if (local.length <= 2) return `${'•'.repeat(local.length)}@${domain}`;
    return `${local.slice(0, 2)}${'•'.repeat(Math.min(local.length - 2, 4))}@${domain}`;
  }
  return '•'.repeat(Math.min(val.length, 16));
}

function SecretField({ label, value, masked = false, maskFn, onCopy }: {
  label: string; value: string; masked?: boolean;
  maskFn?: (v: string) => string;
  onCopy: (text: string, label: string) => void;
}) {
  const { tokens } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const display = masked && !revealed ? (maskFn ? maskFn(value) : partialMask(value)) : value;

  const handleReveal = useCallback(() => {
    setRevealed(true);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setRevealed(false), 10_000);
  }, []);

  useEffect(() => {
    return () => { if (revealTimer.current) clearTimeout(revealTimer.current); };
  }, []);

  return (
    <DetailRow label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: masked && !revealed ? tokens.typography.fontFamily : tokens.typography.fontFamilyMono,
          fontSize: '13px', color: tokens.colors.neutral10, flex: 1,
          wordBreak: 'break-all', letterSpacing: masked && !revealed ? '0.1em' : 'normal',
        }}>
          {display}
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {masked && (
            <IconBtn label={revealed ? 'Ocultar' : 'Revelar'} onClick={revealed ? () => setRevealed(false) : handleReveal}>
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </IconBtn>
          )}
          <IconBtn label={`Copiar ${label}`} onClick={() => onCopy(value, label)}>
            <CopyIcon />
          </IconBtn>
        </div>
      </div>
    </DetailRow>
  );
}

function AttachButton({ item, vault, masterPassword, onVaultChange }: { item: VaultItem; vault: VaultData; masterPassword: string; onVaultChange: (v: VaultData) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { addToast } = useToast();
  return (
    <>
      <Button variant="secondary" onClick={() => inputRef.current?.click()}>Anexar</Button>
      <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={async e => {
        const file = e.target.files?.[0];
        if (!file) { addToast({ type: 'error', title: 'Nenhum arquivo selecionado' }); return; }
        const updated = await addAttachment(vault, item.id, file, masterPassword);
        onVaultChange(updated);
        addToast({ type: 'success', title: 'Arquivo anexado!' });
        e.target.value = '';
      }} />
    </>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  const { tokens } = useTheme();
  return (
    <div>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '10px', color: tokens.colors.neutral7, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <p style={{ fontFamily: tokens.typography.fontFamily, fontSize: '12px', color: tokens.colors.neutral9, marginTop: 2 }}>{value}</p>
    </div>
  );
}

function NavBtn({ children, label, count, active, onClick, color, compact }: {
  children: React.ReactNode; label: string; count?: number;
  active: boolean; onClick: () => void; color?: string; compact?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const { tokens } = useTheme();
  const accent = color ?? '#4f98a3';
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: '100%', padding: '8px 12px', borderRadius: 9,
        display: 'flex', alignItems: 'center', gap: 10, border: 'none',
        borderLeft: `2px solid ${active ? accent : 'transparent'}`,
        background: active
          ? `linear-gradient(90deg, ${accent}1a 0%, ${accent}06 100%)`
          : hov ? 'var(--bg-surface-hover)' : 'transparent',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.14s',
        color: active ? tokens.colors.neutral12 : hov ? tokens.colors.neutral9 : tokens.colors.neutral7,
      }}
    >
      <span style={{
        display: 'flex', flexShrink: 0,
        color: active ? accent : hov ? tokens.colors.neutral8 : tokens.colors.neutral6,
        transition: 'color 0.14s',
      }}>
        {children}
      </span>
      {!compact && <span style={{
        fontFamily: tokens.typography.fontFamily, fontSize: '13px',
        fontWeight: active ? 600 : 400, flex: 1, letterSpacing: active ? '0.01em' : 'normal',
      }}>
        {label}
      </span>}
      {!compact && count !== undefined && count > 0 && (
        <span style={{
          fontFamily: tokens.typography.fontFamilyMono, fontSize: '10px', fontWeight: 700,
          color: active ? accent : tokens.colors.neutral6,
          background: active ? `${accent}22` : 'var(--bg-surface)',
          border: `1px solid ${active ? `${accent}35` : 'var(--border-dim)'}`,
          borderRadius: 20, padding: '1px 7px', minWidth: 22, textAlign: 'center',
          lineHeight: '16px',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

function SidebarLabel({ children }: { children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div style={{
      padding: '14px 12px 5px',
      fontFamily: tokens.typography.fontFamily,
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
      color: tokens.colors.neutral6, textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

function LogoutButton({ onLogout }: { onLogout: () => void }) {
  const [hov, setHov] = useState(false);
  const { tokens } = useTheme();
  return (
    <button
      onClick={onLogout}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Bloquear vault"
      style={{
        background: hov ? 'rgba(209,99,167,0.12)' : 'var(--bg-surface)',
        border: `1px solid ${hov ? 'rgba(209,99,167,0.25)' : 'var(--border-medium)'}`,
        borderRadius: 7, padding: 6, cursor: 'pointer', flexShrink: 0,
        color: hov ? '#e87da0' : tokens.colors.neutral7,
        display: 'flex', transition: 'all 0.15s',
      }}
    >
      <LogoutIcon />
    </button>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { tokens } = useTheme();
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: tokens.colors.neutral6, pointerEvents: 'none' }}>
        <SearchIcon />
      </div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Buscar..."
        style={{
          width: '100%', padding: '8px 10px 8px 32px',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-medium)',
          borderRadius: 8, color: tokens.colors.neutral11,
          fontFamily: tokens.typography.fontFamily, fontSize: '13px', outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(79,152,163,0.5)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-medium)'; }}
      />
      {value && (
        <button onClick={() => onChange('')} style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          color: tokens.colors.neutral7, padding: 2, display: 'flex',
        }}>
          <XIcon />
        </button>
      )}
    </div>
  );
}

function PlusIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1={12} y1={5} x2={12} y2={19} /><line x1={5} y1={12} x2={19} y2={12} /></svg>; }
function SidebarFolderIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>; }

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  const { tokens } = useTheme();
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hov ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
        border: '1px solid var(--border-dim)', cursor: 'pointer',
        color: hov ? tokens.colors.neutral11 : tokens.colors.neutral8,
        transition: 'all 0.13s',
      }}
    >
      {children}
    </button>
  );
}

// ─── TypeIcon ─────────────────────────────────────────────────────────────────

function TypeIcon({ type, size, color }: { type: VaultItemType; size: number; color: string }) {
  const s = { width: size, height: size, fill: 'none', stroke: color, strokeWidth: 1.6 };
  switch (type) {
    case 'password': return <svg viewBox="0 0 24 24" style={s}><rect x={3} y={11} width={18} height={11} rx={2} /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>;
    case 'card': return <svg viewBox="0 0 24 24" style={s}><rect x={1} y={4} width={22} height={16} rx={2} /><line x1={1} y1={10} x2={23} y2={10} /></svg>;
    case 'note': return <svg viewBox="0 0 24 24" style={s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>;
    case 'identity': return <svg viewBox="0 0 24 24" style={s}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx={12} cy={7} r={4} /></svg>;
    case 'totp': return <svg viewBox="0 0 24 24" style={s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="12 8 12 12 14 14" /></svg>;
    case 'passkey': return <svg viewBox="0 0 24 24" style={s}><path d="M12 11c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" /><path d="M12 8v3M12 16h.01" /></svg>;
  }
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function LockIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="rgba(79,152,163,0.7)" strokeWidth={1.7}><rect x={3} y={11} width={18} height={11} rx={2} /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>;
}
function ImportIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>; }
function ExportIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>; }
function TrashIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1={10} y1={11} x2={10} y2={17} /><line x1={14} y1={11} x2={14} y2={17} /></svg>; }
function GridIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><rect x={3} y={3} width={7} height={7} /><rect x={14} y={3} width={7} height={7} /><rect x={3} y={14} width={7} height={7} /><rect x={14} y={14} width={7} height={7} /></svg>; }
function StarIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>; }
function KeyIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>; }
function ShieldClockIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="12 8 12 12 14 14" /></svg>; }
function CardIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><rect x={1} y={4} width={22} height={16} rx={2} /><line x1={1} y1={10} x2={23} y2={10} /></svg>; }
function NoteIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></svg>; }
function PersonIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx={12} cy={7} r={4} /></svg>; }
function WandIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M15 4V2m0 14v-2M8 9H2m14 0h-2M13.8 13.8l1.4 1.4M4.8 4.8l1.4 1.4M13.8 4.2l1.4-1.4M4.8 19.2l1.4-1.4" /><circle cx={10} cy={9} r={3} /><path d="M10 12v8l4-2 4 2V12" /></svg>; }
function LogoutIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>; }
function CopyIcon() { return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><rect x={9} y={9} width={13} height={13} rx={2} /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>; }
function EyeIcon() { return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx={12} cy={12} r={3} /></svg>; }
function EyeOffIcon() { return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" /></svg>; }
function SearchIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2={16.65} y2={16.65} /></svg>; }
function XIcon() { return <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1={18} y1={6} x2={6} y2={18} /><line x1={6} y1={6} x2={18} y2={18} /></svg>; }

