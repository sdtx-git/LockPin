import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTheme, PALETTES } from '@ui/contexts/ThemeContext';
import { useDebounce } from '@ui/contexts/useDebounce';
import { useKeyboard } from '@ui/contexts/useKeyboard';
import { PasswordGenerator, PasswordStrengthMeter } from '@ui/components/molecules';
import { Button, Logo, TitleBar } from '@ui/components/atoms';
import { Modal, useConfirm } from '@ui/components/organisms';
import { useToast } from '@ui/components/organisms';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { VaultItem, VaultItemType, VaultData } from '@core/vault/types';
import { searchItems, addItem, updateItem, deleteItem, restoreItem, emptyTrash, addAttachment } from '@core/vault/storage';
import { exportVault } from '@core/vault/storage';
import { parseBitwardenCsv, parseChromeCsv, parseGenericCsv, parseAegisJson, parse2fasJson, parseOtpauthList, importItems } from '@core/vault/import';
import type { ImportResult } from '@core/vault/import';
import { readQrFromFile } from './qr';
import { formatDate, saveFile } from '@shared/utils';
import { shareItem, revokeSharing, getActiveShares } from '@core/sharing/service';
import { generateTOTP, getTOTPRemainingSeconds, isValidSecret, sanitizeOptions, totpOptionsOf } from '@core/vault/totp';
import type { TotpOptions } from '@core/vault/totp';
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

type ImportFormat = 'bitwarden' | 'chrome' | 'generic' | 'google' | 'aegis' | '2fas' | 'otpauth';

const IMPORT_HINT: Record<ImportFormat, string> = {
  bitwarden: 'Bitwarden: Ferramentas > Exportar cofre > .csv. Logins com TOTP viram também um item de Autenticador.',
  chrome: 'Chrome: Gerenciador de senhas > Configurações > Exportar senhas.',
  generic: 'Colunas aceitas: title/name, username, password, url, note.',
  google: 'No Google Authenticator: Transferir contas > Exportar. Tire um print de cada QR e use "Ler QR de imagem".',
  aegis: 'No Aegis: Configurações > Importar e exportar > Exportar, formato JSON, sem criptografia.',
  '2fas': 'No 2FAS: Configurações > Backup > Exportar para arquivo, sem senha.',
  otpauth: 'Um link otpauth://totp/... por linha. Também aceita prints de QR code de cada serviço.',
};

function runImport(format: ImportFormat, text: string): ImportResult {
  switch (format) {
    case 'bitwarden': return { items: parseBitwardenCsv(text), skipped: 0 };
    case 'chrome': return { items: parseChromeCsv(text), skipped: 0 };
    case 'generic': return { items: parseGenericCsv(text), skipped: 0 };
    case 'aegis': return parseAegisJson(text);
    case '2fas': return parse2fasJson(text);
    case 'google':
    case 'otpauth': return parseOtpauthList(text);
  }
}

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
  const [importFormat, setImportFormat] = useState<ImportFormat>('generic');
  const importFileRef = useRef<HTMLInputElement>(null);
  const importQrRef = useRef<HTMLInputElement>(null);
  const [exportPassword, setExportPassword] = useState('');
  const { addToast } = useToast();
  const { theme, setTheme, palette, setPalette } = useTheme();
  const [showSettings, setShowSettings] = useState(false);

  const mobile = useNarrow();
  const collapsed = sidebarCollapsed && !mobile;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navDepth = useRef(0);
  const drawerRef = useRef(false);
  drawerRef.current = drawerOpen;

  const pushNav = useCallback(() => {
    window.history.pushState({ lockpin: true }, '');
    navDepth.current += 1;
  }, []);
  const popNav = useCallback(() => {
    if (navDepth.current > 0) window.history.back();
  }, []);

  useEffect(() => {
    const onPop = () => {
      navDepth.current = Math.max(0, navDepth.current - 1);
      if (drawerRef.current) setDrawerOpen(false);
      else setSelectedItem(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (mobile && !selectedItem && !drawerOpen && navDepth.current > 0) popNav();
  }, [mobile, selectedItem, drawerOpen, popNav]);

  const openItem = useCallback((item: VaultItem) => {
    if (mobile && navDepth.current === 0) pushNav();
    setSelectedItem(item);
  }, [mobile, pushNav]);
  const openDrawer = () => { pushNav(); setDrawerOpen(true); };
  const pick = (f: FilterType) => { setFilter(f); if (mobile) popNav(); };
  const tool = (fn: () => void) => () => { if (mobile) popNav(); fn(); };

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

  useEffect(() => {
    if (selectedItem && filter !== 'folders' && filter !== 'trash' && !filtered.some(i => i.id === selectedItem.id)) setSelectedItem(null);
  }, [filtered]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Modal openers ────────────────────────────────────────────────────────────

  const openAddModal = useCallback(() => {
    setEditingItem(null);
    setForm(emptyForm());
    setShowAddModal(true);
  }, []);

  const openAddModalOf = useCallback((type: VaultItemType) => {
    setEditingItem(null);
    setForm({ ...emptyForm(), type });
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
      setTimeout(async () => {
        const current = await readText().catch(() => null);
        if (current === text) await writeText('').catch(() => {});
      }, CLIPBOARD_CLEAR_MS);
    } catch {
      addToast({ type: 'error', title: 'Falha ao copiar' });
    }
  }, [addToast]);

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!form.title.trim()) { addToast({ type: 'error', title: 'Título obrigatório' }); return; }
    if (form.type === 'password' && !form.password) { addToast({ type: 'error', title: 'Senha obrigatória' }); return; }
    if (form.type === 'totp' && !form.totpSeed) { addToast({ type: 'error', title: 'Semente TOTP obrigatória' }); return; }
    if (form.type === 'totp' && !isValidSecret(form.totpSeed)) { addToast({ type: 'error', title: 'Semente TOTP inválida', description: 'Use só letras A-Z e números 2-7, ou cole o link otpauth://.' }); return; }

    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
    const isEdit = editingItem !== null;

    const props: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'> = {
      type: form.type,
      title: form.title.trim(),
      url: form.url || undefined,
      username: form.username || undefined,
      password: form.type === 'password' ? (form.password || undefined) : undefined,
      totpSeed: form.type === 'totp' ? (form.totpSeed || undefined) : undefined,
      totpOptions: form.type === 'totp' ? sanitizeOptions({ algorithm: form.totpAlgorithm, digits: form.totpDigits, period: form.totpPeriod }) : undefined,
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
      {mobile && drawerOpen && <div className="drawer-backdrop" onClick={popNav} />}
      <aside className={`sidebar${mobile ? ` sidebar--drawer${drawerOpen ? ' is-open' : ''}` : ''}`} style={{ width: mobile ? 280 : collapsed ? 56 : 224 }} aria-hidden={mobile && !drawerOpen ? true : undefined}>
        <div data-tauri-drag-region style={{ height: 56, padding: collapsed ? 0 : '0 10px 0 14px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10, flexShrink: 0 }}>
          {!collapsed && <>
            <Logo size={26} />
            <span data-tauri-drag-region style={{ flex: 1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--sidebar-text-strong)' }}>LockPin</span>
          </>}
          {!mobile && <button className="sidebar__icon-btn" onClick={() => setSidebarCollapsed(v => !v)}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x={3} y={4} width={18} height={16} rx={2} /><line x1={9} y1={4} x2={9} y2={20} /></svg>
          </button>}
        </div>

        <div style={{ padding: '2px 8px 10px' }} hidden={mobile}>
          <button className={`nav-item sidebar__new${collapsed ? ' nav-item--compact' : ''}`} onClick={openAddModal} title="Novo item (Ctrl+N)">
            <PlusIcon />
            {!collapsed && <span className="nav-item__label">Novo item</span>}
            {!collapsed && <kbd className="kbd kbd--sidebar">Ctrl N</kbd>}
          </button>
        </div>

        <nav style={{ flex: 1, padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
          <NavBtn label="Todos os itens" count={counts.all} active={filter === 'all'} onClick={() => pick('all')} compact={collapsed} dimWhenEmpty={false}>
            <GridIcon />
          </NavBtn>
          <NavBtn label="Favoritos" count={counts.favorites} active={filter === 'favorites'} onClick={() => pick('favorites')} compact={collapsed}>
            <StarIcon />
          </NavBtn>

          {collapsed ? <div className="sidebar__divider" /> : <p className="nav-group">Categorias</p>}

          <NavBtn label="Senhas" count={counts.password ?? 0} active={filter === 'password'} onClick={() => pick('password')} compact={collapsed}>
            <KeyIcon />
          </NavBtn>
          <NavBtn label="Autenticador" count={counts.totp ?? 0} active={filter === 'totp'} onClick={() => pick('totp')} compact={collapsed}>
            <ShieldClockIcon />
          </NavBtn>
          <NavBtn label="Cartões" count={counts.card ?? 0} active={filter === 'card'} onClick={() => pick('card')} compact={collapsed}>
            <CardIcon />
          </NavBtn>
          <NavBtn label="Notas" count={counts.note ?? 0} active={filter === 'note'} onClick={() => pick('note')} compact={collapsed}>
            <NoteIcon />
          </NavBtn>
          <NavBtn label="Identidades" count={counts.identity ?? 0} active={filter === 'identity'} onClick={() => pick('identity')} compact={collapsed}>
            <PersonIcon />
          </NavBtn>
          <NavBtn label="Passkeys" count={counts.passkey ?? 0} active={filter === 'passkey'} onClick={() => pick('passkey')} compact={collapsed}>
            <TypeIcon type="passkey" size={14} color="currentColor" />
          </NavBtn>

          {collapsed ? <div className="sidebar__divider" /> : <p className="nav-group">Organizar</p>}

          <NavBtn label="Pastas seguras" count={vault.folders?.length ?? 0} active={filter === 'folders'} onClick={() => pick('folders')} compact={collapsed}>
            <SidebarFolderIcon />
          </NavBtn>
          <NavBtn label="Lixeira" count={vault.trash?.length ?? 0} active={filter === 'trash'} onClick={() => pick('trash')} compact={collapsed}>
            <TrashIcon />
          </NavBtn>
        </nav>

        <div className={`sidebar__tools${mobile ? ' sidebar__tools--list' : collapsed ? ' sidebar__tools--compact' : ''}`}>
          <ToolBtn label="Gerador de senhas" text={mobile ? 'Gerador de senhas' : undefined} onClick={tool(() => setShowGenerator(true))}><WandIcon /></ToolBtn>
          <ToolBtn label="Importar" text={mobile ? 'Importar' : undefined} onClick={tool(() => setShowImport(true))}><ImportIcon /></ToolBtn>
          <ToolBtn label="Exportar" text={mobile ? 'Exportar' : undefined} onClick={tool(() => setShowExport(true))}><ExportIcon /></ToolBtn>
          <ToolBtn label="Configurações" text={mobile ? 'Configurações' : undefined} onClick={tool(() => setShowSettings(true))}><GearIcon /></ToolBtn>
          <ToolBtn label="Bloquear vault (Ctrl+L)" text={mobile ? 'Bloquear' : undefined} onClick={tool(onLogout)}><LogoutIcon /></ToolBtn>
        </div>
      </aside>

      <div className="app-column">
      <TitleBar />
      <div className={`vault-main${mobile ? ' vault-main--mobile' : ''}`}>
      {mobile && (
        <header className="mobile-bar">
          {selectedItem && filter !== 'folders' && filter !== 'trash'
            ? <button type="button" className="icon-btn" aria-label="Voltar" onClick={() => (navDepth.current > 0 ? popNav() : setSelectedItem(null))}><BackIcon /></button>
            : <button type="button" className="icon-btn" aria-label="Abrir menu" onClick={openDrawer}><MenuIcon /></button>}
          <span className="mobile-bar__title">{filter === 'folders' ? 'Pastas seguras' : filter === 'trash' ? 'Lixeira' : FILTER_LABEL[filter] ?? 'Itens'}</span>
        </header>
      )}

      {filter === 'folders' ? (
        /* ══ FOLDER MODE — replaces panes 2 & 3 ════════════════════════════ */
        <FolderPane
          folders={vault.folders ?? []}
          onChange={newFolders => onVaultChange({ ...vault, folders: newFolders })}
        />
      ) : filter === 'trash' ? (
        /* ══ TRASH VIEW ════════════════════════════════════════════════════ */
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--canvas)' }}>
          <div className="page-body" style={{ maxWidth: 720 }}>
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
      ) : vault.items.length === 0 ? (
        <EmptyVaultPane onCreate={openAddModalOf} onImport={() => setShowImport(true)} />
      ) : (
        <>
          {/* ══ PANE 2 — Item List ══════════════════════════════════════════ */}
          {!(mobile && selectedItem) && <div style={{
            width: mobile ? 'auto' : 304, flex: mobile ? 1 : undefined, flexShrink: 0, background: 'var(--canvas)',
            borderRight: mobile ? 'none' : '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
          }}>
            <div style={{ padding: '12px 12px 8px' }}>
              <SearchField value={search} onChange={setSearch} inputRef={searchRef} onKeyDown={onListKey} />
              <div className="list-head">
                <span className="list-head__title">{FILTER_LABEL[filter] ?? 'Itens'}</span>
                <span className="list-head__count">{filtered.length}</span>
              </div>
            </div>
            <div role="listbox" aria-label="Itens do vault" onKeyDown={onListKey} style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
              {filtered.length === 0 ? (
                <div className="empty empty--sm">
                  <span className="empty__mark">{search ? <SearchIcon /> : <FilterIcon filter={filter} />}</span>
                  <p className="empty__title">{search ? 'Nada encontrado' : `Nada em ${(FILTER_LABEL[filter] ?? 'Itens').toLowerCase()}`}</p>
                  <p className="empty__text">{search ? 'Tente outro termo de busca.' : 'Os itens deste tipo aparecem aqui quando forem criados.'}</p>
                </div>
              ) : (
                filtered.map(item => (
                  <ItemCard
                    key={item.id} item={item}
                    selected={selectedItem?.id === item.id}
                    onSelect={openItem}
                    onToggleFavorite={handleToggleFavorite}
                    onCopy={copy}
                  />
                ))
              )}
            </div>
          </div>}

          {/* ══ PANE 3 — Detail ═════════════════════════════════════════════ */}
          {(!mobile || selectedItem) && <div style={{ flex: 1, background: 'var(--canvas)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
            {!selectedItem ? (
              <EmptyDetailPane />
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
          </div>}
        </>
      )}
      </div>
      </div>

      {mobile && !selectedItem && filter !== 'folders' && filter !== 'trash' && (
        <button type="button" className="fab" aria-label="Novo item" onClick={openAddModal}><PlusIcon /></button>
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
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Configurações" size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <p className="field-label">Modo</p>
            <div className="segmented" role="group" aria-label="Modo de cor">
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Claro</button>
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Escuro</button>
            </div>
          </div>
          <div>
            <p className="field-label">Paleta</p>
            <div className="palette-grid" role="group" aria-label="Paleta de cores">
              {PALETTES.map(p => (
                <button key={p.id} type="button" className="palette-option" aria-pressed={palette === p.id} onClick={() => setPalette(p.id)}>
                  <span className="palette-option__swatches">{p.swatches.map(c => <i key={c} style={{ background: c }} />)}</span>
                  <span className="palette-option__name">{p.label}</span>
                  <span className="palette-option__desc">{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={showGenerator} onClose={() => setShowGenerator(false)} title="Gerador de senhas" size="sm">
        <PasswordGenerator onPasswordGenerated={pwd => {
          setShowGenerator(false);
          openAddModal();
          setForm(f => ({ ...f, password: pwd, type: 'password' }));
        }} />
      </Modal>

      {/* Import */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Importar itens" size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="field-label" htmlFor="import-format">Origem</label>
            <select id="import-format" className="input" value={importFormat} onChange={e => setImportFormat(e.target.value as ImportFormat)}>
              <optgroup label="Senhas">
                <option value="bitwarden">Bitwarden (CSV)</option>
                <option value="chrome">Chrome (CSV)</option>
                <option value="generic">CSV genérico</option>
              </optgroup>
              <optgroup label="Autenticador">
                <option value="google">Google Authenticator (QR de transferência)</option>
                <option value="aegis">Aegis (JSON sem criptografia)</option>
                <option value="2fas">2FAS (.2fas sem senha)</option>
                <option value="otpauth">Links otpauth:// (um por linha)</option>
              </optgroup>
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{IMPORT_HINT[importFormat]}</p>
          </div>
          <div>
            <label className="field-label" htmlFor="import-content">Conteúdo</label>
            <textarea
              id="import-content"
              value={importCsv}
              onChange={e => setImportCsv(e.target.value)}
              rows={7}
              placeholder="Cole aqui o conteúdo exportado"
              className="input mono"
              style={{ fontSize: 12 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => importFileRef.current?.click()}>Abrir arquivo</Button>
              {(importFormat === 'google' || importFormat === 'otpauth') && (
                <Button variant="secondary" size="sm" onClick={() => importQrRef.current?.click()}>Ler QR de imagem</Button>
              )}
              <input ref={importFileRef} type="file" hidden accept=".csv,.json,.2fas,.txt" onChange={async e => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (file) setImportCsv(await file.text());
              }} />
              <input ref={importQrRef} type="file" hidden accept="image/*" onChange={async e => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (!file) return;
                const text = await readQrFromFile(file).catch(() => null);
                if (!text) { addToast({ type: 'error', title: 'Nenhum QR code encontrado na imagem' }); return; }
                setImportCsv(prev => (prev.trim() ? `${prev.trim()}\n${text}` : text));
              }} />
            </div>
          </div>
          <Button onClick={() => {
            if (!importCsv.trim()) { addToast({ type: 'error', title: 'Cole o conteúdo primeiro' }); return; }
            let result: ImportResult;
            try {
              result = runImport(importFormat, importCsv);
            } catch (err) {
              addToast({ type: 'error', title: 'Não foi possível importar', description: err instanceof Error ? err.message : undefined });
              return;
            }
            if (result.items.length === 0) { addToast({ type: 'error', title: 'Nenhum item encontrado', description: result.skipped ? `${result.skipped} entrada(s) ignorada(s) por formato não suportado.` : undefined }); return; }
            onVaultChange(importItems(vault, result.items));
            setImportCsv('');
            setShowImport(false);
            addToast({
              type: 'success',
              title: `${result.items.length} item(ns) importados`,
              description: result.skipped ? `${result.skipped} entrada(s) ignorada(s): só contas TOTP são suportadas.` : undefined,
            });
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

function EmptyDetailPane() {
  return (
    <div className="empty" style={{ flex: 1 }}>
      <span className="avatar empty__avatar" aria-hidden>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x={4} y={10} width={16} height={11} rx={2} /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
      </span>
      <p className="empty__title" style={{ fontSize: 15 }}>Nenhum item selecionado</p>
      <p className="empty__text">Escolha um item na lista para ver os detalhes.</p>
      <div className="empty__shortcuts">
        <span><kbd className="kbd">Ctrl N</kbd> Novo item</span>
        <span><kbd className="kbd">Ctrl F</kbd> Buscar</span>
        <span><kbd className="kbd">Ctrl L</kbd> Bloquear</span>
      </div>
    </div>
  );
}

function EmptyVaultPane({ onCreate, onImport }: { onCreate: (type: VaultItemType) => void; onImport: () => void }) {
  const starts: { type: VaultItemType; label: string; hint: string }[] = [
    { type: 'password', label: 'Senha', hint: 'Login de site ou app' },
    { type: 'card', label: 'Cartão', hint: 'Crédito ou débito' },
    { type: 'note', label: 'Nota', hint: 'Texto protegido' },
  ];
  return (
    <div className="welcome">
      <Logo size={64} />
      <h2 className="welcome__title">Seu vault está pronto</h2>
      <p className="welcome__text">Guarde o primeiro item. Tudo fica cifrado neste dispositivo, sem conta e sem nuvem.</p>
      <div className="welcome__grid">
        {starts.map(s => (
          <button key={s.type} type="button" className="welcome__card" onClick={() => onCreate(s.type)}>
            <span className="avatar"><TypeIcon type={s.type} size={17} color="currentColor" /></span>
            <strong>{s.label}</strong>
            <span>{s.hint}</span>
          </button>
        ))}
        <button type="button" className="welcome__card" onClick={onImport}>
          <span className="avatar"><ImportIcon /></span>
          <strong>Importar</strong>
          <span>De outro gerenciador</span>
        </button>
      </div>
    </div>
  );
}

function useNarrow(): boolean {
  const query = '(max-width: 719px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

function MenuIcon() { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>; }
function BackIcon() { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>; }

function FilterIcon({ filter }: { filter: FilterType }) {
  switch (filter) {
    case 'favorites': return <StarIcon />;
    case 'password': return <KeyIcon />;
    case 'totp': return <ShieldClockIcon />;
    case 'card': return <CardIcon />;
    case 'note': return <NoteIcon />;
    case 'identity': return <PersonIcon />;
    case 'passkey': return <TypeIcon type="passkey" size={14} color="currentColor" />;
    default: return <GridIcon />;
  }
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
       <div className="page-body" style={{ maxWidth: 640 }}>
        <div className="card hero">
          <div className="hero__band" />
          <div className="hero__body">
            <ItemAvatar item={item} size={60} className="hero__avatar" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 className="hero__title">{item.title}</h2>
              <p className="hero__meta">
                <TypeIcon type={item.type} size={12} color="currentColor" />
                {TYPE_LABEL[item.type]} · atualizado {formatDate(item.updatedAt)}
              </p>
            </div>
            <FavoriteStar on={!!item.favorite} onClick={onToggleFavorite} size={18} />
          </div>
        </div>

        {/* Password */}
        {item.type === 'password' && (
          <Section>
            {item.url && <DetailRow label="URL">
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 500, textDecoration: 'none', wordBreak: 'break-all' }}>
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
              <TOTPDisplay seed={item.totpSeed} options={totpOptionsOf(item)} onCopy={code => onCopy(code, 'Código TOTP')} />
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

const TOTPDisplay: React.FC<{ seed: string; options: TotpOptions; onCopy: (code: string) => void }> = ({ seed, options, onCopy }) => {
  const { algorithm, digits, period } = options;
  const [code, setCode] = useState('-'.repeat(digits));
  const [invalid, setInvalid] = useState(false);
  const [remaining, setRemaining] = useState(getTOTPRemainingSeconds(period));

  useEffect(() => {
    let mounted = true;
    let window = -1;
    setInvalid(false);
    const tick = () => {
      const now = Date.now();
      const w = Math.floor(now / (period * 1000));
      setRemaining(getTOTPRemainingSeconds(period));
      if (w === window) return;
      window = w;
      generateTOTP(seed, now, { algorithm, digits, period })
        .then(c => { if (mounted) setCode(c); })
        .catch(() => { if (mounted) setInvalid(true); });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { mounted = false; clearInterval(id); };
  }, [seed, algorithm, digits, period]);

  if (invalid) {
    return <p className="field-error" style={{ marginTop: 0 }}>Semente inválida. Edite o item e cole a semente ou o link otpauth:// de novo.</p>;
  }

  const half = Math.ceil(code.length / 2);
  const pct = remaining / period;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const ringColor = remaining <= 5 ? 'var(--danger)' : 'var(--accent)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span className="mono" style={{ fontSize: 28, fontWeight: 500, color: 'var(--text)', letterSpacing: '0.06em', lineHeight: 1, flex: 1 }}>
        {code.slice(0, half)} {code.slice(half)}
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
      <ItemAvatar item={item} size={38} />
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
            onClick={() => generateTOTP(item.totpSeed!, Date.now(), totpOptionsOf(item)).then(c => onCopy(c, 'Código')).catch(() => {})}>
            <CopyIcon />
          </button>
        )}
      </div>
      <FavoriteStar on={!!item.favorite} onClick={e => { stop(e); onToggleFavorite(item.id); }} size={13} />
    </div>
  );
});

function ItemAvatar({ item, size, className }: { item: VaultItem; size: number; className?: string }) {
  const letter = (item.title.trim()[0] ?? '?').toUpperCase();
  return (
    <span className={`avatar${className ? ` ${className}` : ''}`} aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {letter}
    </span>
  );
}

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

function partialMask(_val: string): string {
  return '•'.repeat(12);
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
        <span className={masked && revealed ? 'mono' : undefined} style={{
          fontSize: 14, color: 'var(--text)', flex: 1, minHeight: 28, display: 'flex', alignItems: 'center',
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

function NavBtn({ children, label, count, active, onClick, compact, dimWhenEmpty = true }: {
  children: React.ReactNode; label: string; count?: number;
  active: boolean; onClick: () => void; compact?: boolean; dimWhenEmpty?: boolean;
}) {
  const dim = dimWhenEmpty && !active && count === 0;
  return (
    <button type="button" onClick={onClick} title={compact ? label : undefined} aria-label={compact ? label : undefined}
      aria-current={active ? 'true' : undefined}
      className={`nav-item${compact ? ' nav-item--compact' : ''}${dim ? ' nav-item--empty' : ''}`}>
      {children}
      {!compact && <span className="nav-item__label">{label}</span>}
      {!compact && count !== undefined && count > 0 && <span className="nav-item__count">{count}</span>}
    </button>
  );
}

function ToolBtn({ label, text, onClick, children }: { label: string; text?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="sidebar__icon-btn" onClick={onClick} aria-label={label} title={text ? undefined : label}>
      {children}
      {text && <span>{text}</span>}
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
        placeholder="Buscar"
        aria-label="Buscar no vault"
        className="input"
        style={{ height: 34, paddingLeft: 32, paddingRight: value ? 32 : 56, background: 'var(--surface-2)', borderColor: 'var(--border)' }}
      />
      {!value && <kbd className="kbd" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>Ctrl F</kbd>}
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
function GearIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx={12} cy={12} r={3} /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>; }
function LogoutIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>; }
function CopyIcon() { return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><rect x={9} y={9} width={13} height={13} rx={2} /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>; }
function EyeIcon() { return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx={12} cy={12} r={3} /></svg>; }
function EyeOffIcon() { return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" /></svg>; }
function SearchIcon() { return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2={16.65} y2={16.65} /></svg>; }
function XIcon() { return <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1={18} y1={6} x2={6} y2={18} /><line x1={6} y1={6} x2={18} y2={18} /></svg>; }
