import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTheme } from '@ui/contexts/ThemeContext';
import { useDebounce } from '@ui/contexts/useDebounce';
import { useKeyboard } from '@ui/contexts/useKeyboard';
import { PasswordGenerator, PasswordStrengthMeter } from '@ui/components/molecules';
import { Button, Logo } from '@ui/components/atoms';
import { Modal, useConfirm } from '@ui/components/organisms';
import { useToast } from '@ui/components/organisms';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { VaultItem, VaultItemType, VaultData } from '@core/vault/types';
import { searchItems, addItem, updateItem, deleteItem, restoreItem, emptyTrash, addAttachment } from '@core/vault/storage';
import { exportVault } from '@core/vault/storage';
import { parseBitwardenCsv, parseChromeCsv, parseGenericCsv, importItems } from '@core/vault/import';
import { formatDate, saveFile } from '@shared/utils';
import { shareItem, revokeSharing, getActiveShares } from '@core/sharing/service';
import { generateTOTP, getTOTPRemainingSeconds } from '@core/vault/totp';
import { createAuditLog } from '@core/audit/logger';
import { CLIPBOARD_CLEAR_MS } from '@shared/constants';
import { VaultItemDialog, emptyForm, itemToForm } from './VaultItemDialog';
import { FolderPane } from './FolderPane';
import type { FormData } from './VaultItemDialog';

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<VaultItemType, string> = {
  password: 'Senha',
  card: 'Cartão',
  note: 'Nota',
  identity: 'Identidade',
  totp: 'Autenticador',
  passkey: 'Passkey',
};

type FilterType = VaultItemType | 'all' | 'favorites' | 'folders' | 'trash';

const FILTER_LABEL: Partial<Record<FilterType, string>> = {
  all: 'Todos os itens', favorites: 'Favoritos', password: 'Senhas', totp: 'Autenticador',
  card: 'Cartões', note: 'Notas', identity: 'Identidades', passkey: 'Passkeys',
};

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
  const { theme, toggle: toggleTheme } = useTheme();

  const [confirm, confirmDialog] = useConfirm();
  const modalOpen = () => !!document.querySelector('[role=dialog]');

  useKeyboard([
    { key: 'f', ctrl: true, handler: () => { if (filter === 'folders' || filter === 'trash') setFilter('all'); searchRef.current?.focus(); searchRef.current?.select(); } },
    { key: 'n', ctrl: true, handler: () => { if (!modalOpen()) openAddModal(); } },
    { key: 'l', ctrl: true, handler: onLogout },
    { key: 'Escape', handler: () => { if (!modalOpen() && selectedItem) setSelectedItem(null); } },
  ]);

  // contagens do menu em uma única passada
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: vault.items.length, favorites: 0 };
    for (const i of vault.items) {
      c[i.type] = (c[i.type] ?? 0) + 1;
      if (i.favorite) c.favorites++;
    }
    return c;
  }, [vault.items]);

  const filtered = useMemo(() => {
    if (filter === 'trash') return [] as VaultItem[];
    let items = searchItems(vault, debouncedSearch);
    if (filter === 'favorites') items = items.filter(i => i.favorite);
    else if (filter !== 'all') items = items.filter(i => i.type === filter);
    return items;
  }, [vault, debouncedSearch, filter]);

  const moveSelection = useCallback((delta: number) => {
    if (filtered.length === 0) return;
    const idx = selectedItem ? filtered.findIndex(i => i.id === selectedItem.id) : -1;
    const next = filtered[Math.min(filtered.length - 1, Math.max(0, idx + delta))];
    setSelectedItem(next);
    document.getElementById(`item-${next.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [filtered, selectedItem]);

  const onListKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Enter' && selectedItem && e.target === searchRef.current) { e.preventDefault(); openEditModalRef.current(selectedItem); }
  }, [moveSelection, selectedItem]);

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
  const openEditModalRef = useRef(openEditModal);

  const closeAddModal = useCallback(() => {
    setShowAddModal(false);
    setEditingItem(null);
    setForm(emptyForm());
  }, []);

  // ── Clipboard ────────────────────────────────────────────────────────────────

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await writeText(text);
      addToast({ type: 'info', title: `${label}: copiado`, description: `A área de transferência será limpa em ${CLIPBOARD_CLEAR_MS / 1000}s.`, duration: 2500 });
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
    addToast({ type: 'info', title: 'Movido para a lixeira' });
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
      style={{ display: 'flex', height: '100vh', background: 'var(--canvas)', overflow: 'hidden' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleAttachDrop(e, vault, onVaultChange, selectedItem?.id ?? null, addToast, masterPassword).catch(() => {}); }}
    >
      {dragOver && <div style={{
        position: 'fixed', inset: 8, zIndex: 9999, borderRadius: 10,
        background: 'var(--accent-soft)', border: '2px dashed var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--accent)' }}>
          Solte para anexar ao item selecionado
        </span>
      </div>}
      {/* ══ PANE 1 — Sidebar ══════════════════════════════════════════════════ */}
      <aside className="sidebar" style={{ width: sidebarCollapsed ? 56 : 224 }}>
        <div style={{ height: 56, padding: sidebarCollapsed ? 0 : '0 10px 0 14px', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: 10, flexShrink: 0 }}>
          {!sidebarCollapsed && <>
            <Logo size={26} />
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--sidebar-text-strong)' }}>LockPin</span>
          </>}
          <button className="sidebar__icon-btn" onClick={() => setSidebarCollapsed(v => !v)}
            aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'} title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x={3} y={4} width={18} height={16} rx={2} /><line x1={9} y1={4} x2={9} y2={20} /></svg>
          </button>
        </div>

        <div style={{ padding: '2px 8px 10px' }}>
          <button className={`nav-item${sidebarCollapsed ? ' nav-item--compact' : ''}`} onClick={openAddModal} title="Novo item (Ctrl+N)"
            style={{ background: 'var(--sidebar-active)', color: 'var(--sidebar-text-strong)', fontWeight: 500, height: 34 }}>
            <PlusIcon />
            {!sidebarCollapsed && <span className="nav-item__label">Novo item</span>}
          </button>
        </div>

        <nav style={{ flex: 1, padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
          <NavBtn label="Todos os itens" count={counts.all} active={filter === 'all'} onClick={() => setFilter('all')} compact={sidebarCollapsed}>
            <GridIcon />
          </NavBtn>
          <NavBtn label="Favoritos" count={counts.favorites} active={filter === 'favorites'} onClick={() => setFilter('favorites')} compact={sidebarCollapsed}>
            <StarIcon />
          </NavBtn>

          <div className="sidebar__divider" />

          <NavBtn label="Senhas" count={counts.password} active={filter === 'password'} onClick={() => setFilter('password')} compact={sidebarCollapsed}>
            <KeyIcon />
          </NavBtn>
          <NavBtn label="Autenticador" count={counts.totp} active={filter === 'totp'} onClick={() => setFilter('totp')} compact={sidebarCollapsed}>
            <ShieldClockIcon />
          </NavBtn>
          <NavBtn label="Cartões" count={counts.card} active={filter === 'card'} onClick={() => setFilter('card')} compact={sidebarCollapsed}>
            <CardIcon />
          </NavBtn>
          <NavBtn label="Notas" count={counts.note} active={filter === 'note'} onClick={() => setFilter('note')} compact={sidebarCollapsed}>
            <NoteIcon />
          </NavBtn>
          <NavBtn label="Identidades" count={counts.identity} active={filter === 'identity'} onClick={() => setFilter('identity')} compact={sidebarCollapsed}>
            <PersonIcon />
          </NavBtn>

          <div className="sidebar__divider" />

          <NavBtn label="Pastas seguras" count={vault.folders?.length ?? 0} active={filter === 'folders'} onClick={() => setFilter('folders')} compact={sidebarCollapsed}>
            <SidebarFolderIcon />
          </NavBtn>
          <NavBtn label="Lixeira" count={vault.trash?.length ?? 0} active={filter === 'trash'} onClick={() => setFilter('trash')} compact={sidebarCollapsed}>
            <TrashIcon />
          </NavBtn>
        </nav>

        <div className={`sidebar__tools${sidebarCollapsed ? ' sidebar__tools--compact' : ''}`}>
          <ToolBtn label="Gerador de senhas" onClick={() => setShowGenerator(true)}><WandIcon /></ToolBtn>
          <ToolBtn label="Importar" onClick={() => setShowImport(true)}><ImportIcon /></ToolBtn>
          <ToolBtn label="Exportar" onClick={() => setShowExport(true)}><ExportIcon /></ToolBtn>
          <ToolBtn label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} onClick={toggleTheme}>
            {theme === 'dark'
              ? <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx={12} cy={12} r={5} /><line x1={12} y1={1} x2={12} y2={3} /><line x1={12} y1={21} x2={12} y2={23} /><line x1={4.22} y1={4.22} x2={5.64} y2={5.64} /><line x1={18.36} y1={18.36} x2={19.78} y2={19.78} /><line x1={1} y1={12} x2={3} y2={12} /><line x1={21} y1={12} x2={23} y2={12} /><line x1={4.22} y1={19.78} x2={5.64} y2={18.36} /><line x1={18.36} y1={5.64} x2={19.78} y2={4.22} /></svg>
              : <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
            }
          </ToolBtn>
          <ToolBtn label="Bloquear vault (Ctrl+L)" onClick={onLogout}><LogoutIcon /></ToolBtn>
        </div>
      </aside>

      {filter === 'folders' ? (
        /* ══ FOLDER MODE — replaces panes 2 & 3 ════════════════════════════ */
        <FolderPane
          folders={vault.folders ?? []}
          onChange={newFolders => onVaultChange({ ...vault, folders: newFolders })}
        />
      ) : filter === 'trash' ? (
        /* ══ TRASH VIEW ════════════════════════════════════════════════════ */
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--canvas)' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 28px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, minHeight: 34 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)' }}>Lixeira</h2>
              {(vault.trash?.length ?? 0) > 0 && (
                <Button variant="danger" onClick={async () => {
                  const ok = await confirm({ title: 'Esvaziar lixeira?', message: `${vault.trash.length} ${vault.trash.length === 1 ? 'item será apagado' : 'itens serão apagados'} definitivamente, com seus anexos. Não dá para desfazer.`, confirmLabel: 'Esvaziar lixeira' });
                  if (!ok) return;
                  const v = await emptyTrash(vault); onVaultChange(v); addToast({ type: 'info', title: 'Lixeira esvaziada' });
                }}>
                  Esvaziar lixeira
                </Button>
              )}
            </div>
            {(vault.trash?.length ?? 0) === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Nenhum item excluído. Itens removidos ficam aqui até a lixeira ser esvaziada.</p>
            ) : (
              <div className="card">
                {vault.trash.map(d => (
                  <div key={d.item.id} className="card__row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="tile"><TypeIcon type={d.item.type} size={15} color="currentColor" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="list-item__title">{d.item.title}</p>
                      <p className="list-item__sub">Excluído {formatDate(d.deletedAt)}</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => { onVaultChange(restoreItem(vault, d.item.id)); addToast({ type: 'success', title: 'Item restaurado' }); }}>
                      Restaurar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ══ PANE 2 — Item List ══════════════════════════════════════════ */}
          <div style={{
            width: 304, flexShrink: 0, background: 'var(--surface)',
            borderRight: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 12px 8px' }}>
              <SearchField value={search} onChange={setSearch} inputRef={searchRef} onKeyDown={onListKey} />
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '10px 2px 0' }}>
                {FILTER_LABEL[filter] ?? 'Itens'} · {filtered.length}
              </p>
            </div>
            <div role="listbox" aria-label="Itens do vault" onKeyDown={onListKey} style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
              {filtered.length === 0 ? (
                <div style={{ padding: '36px 16px', textAlign: 'center' }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>
                    {search ? 'Nada encontrado' : 'Nenhum item aqui'}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                    {search ? 'Tente outro termo de busca.' : 'Adicione senhas, cartões, notas e códigos.'}
                  </p>
                </div>
              ) : (
                filtered.map(item => (
                  <ItemCard
                    key={item.id} item={item}
                    selected={selectedItem?.id === item.id}
                    onSelect={setSelectedItem}
                    onToggleFavorite={handleToggleFavorite}
                    onCopy={copy}
                  />
                ))
              )}
            </div>
          </div>

          {/* ══ PANE 3 — Detail ═════════════════════════════════════════════ */}
          <div style={{ flex: 1, background: 'var(--canvas)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
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

      {confirmDialog}

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
        title={`Compartilhar "${selectedItem?.title}"`}
        size="sm"
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
            <span className="field-label">Permissão</span>
            <div className="segmented">
              {(['read', 'write', 'admin'] as const).map(p => (
                <button key={p} type="button" aria-pressed={sharePermission === p} onClick={() => setSharePermission(p)}>
                  {p === 'read' ? 'Leitura' : p === 'write' ? 'Escrita' : 'Admin'}
                </button>
              ))}
            </div>
          </div>
          {selectedItem && getActiveShares(selectedItem).length > 0 && (
            <div>
              <span className="field-label">Compartilhado com</span>
              <div className="card">
                {getActiveShares(selectedItem).map(s => (
                  <div key={s.userId} className="card__row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 8px 7px 12px' }}>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>
                      {s.userId} <span style={{ color: 'var(--text-3)' }}>({s.permissions})</span>
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
            </div>
          )}
        </div>
      </Modal>

      {/* Standalone Generator (sidebar button) */}
      <Modal open={showGenerator} onClose={() => setShowGenerator(false)} title="Gerador de senhas" size="sm">
        <PasswordGenerator onPasswordGenerated={pwd => {
          setShowGenerator(false);
          openAddModal();
          setForm(f => ({ ...f, password: pwd, type: 'password' }));
        }} />
      </Modal>

      {/* Import CSV */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Importar itens" size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <span className="field-label">Origem</span>
            <div className="segmented">
              {(['bitwarden', 'chrome', 'generic'] as const).map(f => (
                <button key={f} type="button" aria-pressed={importFormat === f} onClick={() => setImportFormat(f)}>
                  {f === 'bitwarden' ? 'Bitwarden' : f === 'chrome' ? 'Chrome' : 'CSV genérico'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="field-label">Conteúdo do CSV</label>
            <textarea
              value={importCsv}
              onChange={e => setImportCsv(e.target.value)}
              rows={7}
              placeholder="Cole aqui o conteúdo do arquivo exportado"
              className="input mono"
              style={{ fontSize: 12 }}
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
            Importar itens
          </Button>
        </div>
      </Modal>

      {/* Export Vault */}
      <Modal open={showExport} onClose={() => setShowExport(false)} title="Exportar vault" size="sm">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            O arquivo exportado é cifrado com AES-256-GCM usando a senha abaixo. Ela será pedida para importar.
          </p>
          <div>
            <label className="field-label">Senha do arquivo</label>
            <input
              type="password" value={exportPassword}
              onChange={e => setExportPassword(e.target.value)}
              className="input"
            />
          </div>
          <Button onClick={async () => {
            if (!exportPassword) { addToast({ type: 'error', title: 'Defina uma senha' }); return; }
            try {
              const data = await exportVault(vault, exportPassword);
              await saveFile(`lockpin-export-${Date.now()}.enc`, new TextEncoder().encode(data));
              setExportPassword('');
              setShowExport(false);
              addToast({ type: 'success', title: 'Vault exportado!' });
            } catch { addToast({ type: 'error', title: 'Falha ao exportar' }); }
          }} disabled={!exportPassword}>
            Exportar vault
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
      <label className="field-label">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus} className="input"
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
  const empty = vault.items.length === 0;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-2)' }}>
        {empty ? 'Seu vault está vazio' : 'Nenhum item selecionado'}
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, maxWidth: 300 }}>
        {empty ? 'Guarde a primeira senha, cartão ou nota. Tudo fica cifrado neste computador.' : 'Escolha um item na lista para ver os detalhes.'}
      </p>
      {empty && (
        <div style={{ marginTop: 18 }}>
          <Button onClick={onAddNew}>Novo item</Button>
        </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
       <div style={{ maxWidth: 640, margin: '0 auto', padding: '28px 28px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <span className="tile tile--lg"><TypeIcon type={item.type} size={19} color="currentColor" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.title}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {TYPE_LABEL[item.type]} · atualizado {formatDate(item.updatedAt)}
            </p>
          </div>
          <FavoriteStar on={!!item.favorite} onClick={onToggleFavorite} size={18} />
        </div>

        {/* Password */}
        {item.type === 'password' && (
          <Section>
            {item.url && <DetailRow label="URL">
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, wordBreak: 'break-all' }}>
                {item.url}
              </a>
            </DetailRow>}
            {item.username && <SecretField label="Usuário" value={item.username} onCopy={onCopy} />}
            {item.password && <>
              <SecretField label="Senha" value={item.password} masked onCopy={onCopy} />
              <div className="card__row">
                <PasswordStrengthMeter password={item.password} />
              </div>
            </>}
          </Section>
        )}

        {/* TOTP */}
        {item.type === 'totp' && item.totpSeed && (
          <Section>
            <div className="card__row">
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Código de verificação</p>
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
            <div className="card__split">
              <SecretField label="Validade" value={item.card.expiry} onCopy={onCopy} />
              <SecretField label="CVC" value={item.card.cvc} masked onCopy={onCopy} />
            </div>
          </Section>
        )}

        {/* Note */}
        {item.type === 'note' && (
          <Section>
            <div className="card__row" style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.65, maxHeight: 360, overflowY: 'auto' }}>
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
          <>
            <p className="section-title">Tags</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {item.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
            </div>
          </>
        )}

        {/* Attachments */}
        {(item.attachments?.length ?? 0) > 0 && (
          <>
            <p className="section-title">Anexos</p>
            <div className="card">
              {item.attachments!.map(a => (
                <div key={a.id} className="card__row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>{(a.size / 1024).toFixed(1)} KB</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 20 }}>
          Criado {formatDate(item.createdAt)}
          {getActiveShares(item).length > 0 && ` · compartilhado com ${getActiveShares(item).length}`}
        </p>
       </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Button onClick={onEdit}>Editar</Button>
        <div style={{ width: 4 }} />
        <AttachButton item={item} vault={vault} masterPassword={masterPassword} onVaultChange={onVaultChange} />
        <IconBtn label="Compartilhar" onClick={onShare}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx={18} cy={5} r={3} /><circle cx={6} cy={12} r={3} /><circle cx={18} cy={19} r={3} /><line x1={8.6} y1={13.5} x2={15.4} y2={17.5} /><line x1={15.4} y1={6.5} x2={8.6} y2={10.5} /></svg>
        </IconBtn>
        <div style={{ marginLeft: 'auto' }}>
          <button type="button" className="icon-btn icon-btn--danger" onClick={onDelete} aria-label="Mover para a lixeira" title="Mover para a lixeira"><TrashIcon /></button>
        </div>
      </div>
    </div>
  );
}

// ─── TOTPDisplay ──────────────────────────────────────────────────────────────

const TOTPDisplay: React.FC<{ seed: string; onCopy: (code: string) => void }> = ({ seed, onCopy }) => {
  const [code, setCode] = useState('------');
  const [remaining, setRemaining] = useState(getTOTPRemainingSeconds());

  useEffect(() => {
    let mounted = true;
    let window = -1;
    const tick = () => {
      const now = Date.now();
      const w = Math.floor(now / 30_000);
      setRemaining(getTOTPRemainingSeconds());
      if (w === window) return;
      window = w;
      generateTOTP(seed, now).then(c => { if (mounted) setCode(c); }).catch(() => { /* semente inválida */ });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { mounted = false; clearInterval(id); };
  }, [seed]);

  const pct = remaining / 30;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const ringColor = remaining <= 5 ? 'var(--danger)' : 'var(--accent)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span className="mono" style={{ fontSize: 28, fontWeight: 500, color: 'var(--text)', letterSpacing: '0.06em', lineHeight: 1, flex: 1 }}>
        {code.slice(0, 3)} {code.slice(3)}
      </span>
      <svg width={32} height={32} viewBox="0 0 48 48" role="img" aria-label={`${remaining}s restantes`}>
        <circle cx={24} cy={24} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
        <circle
          cx={24} cy={24} r={r} fill="none"
          stroke={ringColor} strokeWidth={4}
          strokeDasharray={`${circ}`}
          strokeDashoffset={`${circ * (1 - pct)}`}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
        />
        <text x={24} y={29} textAnchor="middle" fill="var(--text-2)" style={{ fontSize: 15, fontWeight: 500 }}>
          {remaining}
        </text>
      </svg>
      <IconBtn label="Copiar código" onClick={() => onCopy(code)}><CopyIcon /></IconBtn>
    </div>
  );
};

// ─── ItemCard (list) ──────────────────────────────────────────────────────────

const ItemCard = React.memo(function ItemCard({ item, selected, onSelect, onToggleFavorite, onCopy }: {
  item: VaultItem;
  selected: boolean;
  onSelect: (item: VaultItem) => void;
  onToggleFavorite: (id: string) => void;
  onCopy: (text: string, label: string) => void;
}) {
  const secret = item.type === 'password' ? item.password : undefined;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div id={`item-${item.id}`} role="option" tabIndex={selected ? 0 : -1} aria-selected={selected} className="list-item" style={{ cursor: 'pointer' }}
      onClick={() => onSelect(item)}
    >
      <span className="tile"><TypeIcon type={item.type} size={15} color="currentColor" /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="list-item__title">{item.title}</div>
        <div className="list-item__sub">{itemSubtitle(item)}</div>
      </div>
      <div className="list-item__actions" onClick={stop}>
        {item.username && (
          <button type="button" className="icon-btn" title="Copiar usuário" aria-label={`Copiar usuário de ${item.title}`} onClick={() => onCopy(item.username!, 'Usuário')}>
            <PersonIcon />
          </button>
        )}
        {secret && (
          <button type="button" className="icon-btn" title="Copiar senha" aria-label={`Copiar senha de ${item.title}`} onClick={() => onCopy(secret, 'Senha')}>
            <KeyIcon />
          </button>
        )}
        {item.type === 'totp' && item.totpSeed && (
          <button type="button" className="icon-btn" title="Copiar código" aria-label={`Copiar código de ${item.title}`}
            onClick={() => generateTOTP(item.totpSeed!, Date.now()).then(c => onCopy(c, 'Código')).catch(() => {})}>
            <CopyIcon />
          </button>
        )}
      </div>
      <FavoriteStar on={!!item.favorite} onClick={e => { stop(e); onToggleFavorite(item.id); }} size={13} />
    </div>
  );
});

function FavoriteStar({ on, onClick, size }: { on: boolean; onClick: (e: React.MouseEvent) => void; size: number }) {
  return (
    <button type="button" className="star" aria-pressed={on} onClick={onClick}
      aria-label={on ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} title={on ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card__row">
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>{label}</p>
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span className={masked && !revealed ? undefined : 'mono'} style={{
          fontSize: 13, color: 'var(--text)', flex: 1, minHeight: 28, display: 'flex', alignItems: 'center',
          wordBreak: 'break-all', letterSpacing: masked && !revealed ? '0.12em' : 'normal',
        }}>
          {display}
        </span>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
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
      <button type="button" className="icon-btn" onClick={() => inputRef.current?.click()} aria-label="Anexar arquivo" title="Anexar arquivo">
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
      </button>
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

function NavBtn({ children, label, count, active, onClick, compact }: {
  children: React.ReactNode; label: string; count?: number;
  active: boolean; onClick: () => void; compact?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={compact ? label : undefined} aria-label={compact ? label : undefined}
      aria-current={active ? 'true' : undefined}
      className={`nav-item${compact ? ' nav-item--compact' : ''}`}>
      {children}
      {!compact && <span className="nav-item__label">{label}</span>}
      {!compact && count !== undefined && count > 0 && <span className="nav-item__count">{count}</span>}
    </button>
  );
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="sidebar__icon-btn" onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function SearchField({ value, onChange, inputRef, onKeyDown }: { value: string; onChange: (v: string) => void; inputRef?: React.Ref<HTMLInputElement>; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 11, top: 0, bottom: 0, display: 'flex', alignItems: 'center', color: 'var(--text-3)', pointerEvents: 'none' }}>
        <SearchIcon />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } else onKeyDown?.(e); }}
        placeholder="Buscar  (Ctrl+F)"
        aria-label="Buscar no vault"
        className="input"
        style={{ height: 34, paddingLeft: 32, paddingRight: 32, background: 'var(--surface-2)', borderColor: 'var(--border)' }}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Limpar busca" className="icon-btn"
          style={{ position: 'absolute', right: 4, top: 4, width: 26, height: 26 }}>
          <XIcon />
        </button>
      )}
    </div>
  );
}

function PlusIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1={12} y1={5} x2={12} y2={19} /><line x1={5} y1={12} x2={19} y2={12} /></svg>; }
function SidebarFolderIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>; }

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="icon-btn">
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
