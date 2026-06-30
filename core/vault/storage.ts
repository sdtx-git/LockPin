import { invoke } from '@tauri-apps/api/core';
import type { VaultData, VaultItem, DeletedItem, RecoveryKey, VaultAttachment } from './types';
import { encryptVault, decryptVault, serializeVault, deserializeVault, deriveKey, deriveBits } from '@core/crypto/encryption';
import { KDF_ITERATIONS } from '@shared/constants';
import { generateId } from '@shared/utils';

// ─── Vault CRUD ───────────────────────────────────────────────────────────────

export async function loadVault(masterPassword: string, vaultId: string): Promise<VaultData | null> {
  const serialized = await invoke<string>('read_vault', { vaultId }).catch(() => null);
  if (!serialized) return null;
  const vaultData = deserializeVault(serialized);
  const decrypted = await decryptVault(vaultData, masterPassword);
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as VaultData;
  if (!parsed.folders) parsed.folders = [];
  if (!parsed.trash) parsed.trash = [];
  return parsed;
}

export async function saveVault(vault: VaultData, masterPassword: string, vaultId: string): Promise<void> {
  const json = JSON.stringify(vault);
  const data = new TextEncoder().encode(json).buffer;
  const encrypted = await encryptVault(data, masterPassword);
  await invoke('write_vault', { vaultId, data: serializeVault(encrypted) });
  autoBackup(vault, masterPassword, vaultId);
}

export async function vaultExists(): Promise<boolean> {
  return invoke<boolean>('vault_exists');
}

export async function deleteVaultData(vaultId: string): Promise<void> {
  await invoke('delete_vault', { vaultId });
}

async function autoBackup(vault: VaultData, masterPassword: string, vaultId: string): Promise<void> {
  try {
    const json = JSON.stringify(vault);
    const data = new TextEncoder().encode(json).buffer;
    const encrypted = await encryptVault(data, masterPassword);
    const serialized = serializeVault(encrypted);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await invoke('write_backup', { vaultId, data: serialized, timestamp });
  } catch {
    // silent
  }
}

export async function exportVault(vault: VaultData, exportPassword: string): Promise<string> {
  const json = JSON.stringify(vault);
  const data = new TextEncoder().encode(json).buffer;
  const encrypted = await encryptVault(data, exportPassword);
  return serializeVault(encrypted);
}

export async function setRecoveryKey(vault: VaultData, masterPassword: string, hint: string): Promise<{ vault: VaultData; words: string }> {
  const words = generateRecoveryWords();
  const recoveryWordsKey = await deriveKeyFromWords(words);
  const encryptedKey = await encryptVaultData(new TextEncoder().encode(masterPassword).buffer, recoveryWordsKey);

  const rk: RecoveryKey = {
    encryptedMasterKey: serializeVault(encryptedKey),
    salt: '',
    hint,
    createdAt: new Date().toISOString(),
  };
  return { vault: { ...vault, recoveryKey: rk }, words };
}

export async function recoverVault(recoveryWords: string, vault: VaultData, vaultId: string): Promise<{ vault: VaultData; masterPassword: string } | null> {
  if (!vault.recoveryKey) return null;
  try {
    const wordsKey = await deriveKeyFromWords(recoveryWords);
    const encryptedData = deserializeVault(vault.recoveryKey.encryptedMasterKey);
    const decrypted = await decryptVaultData(encryptedData, wordsKey);
    const masterPassword = new TextDecoder().decode(decrypted);
    const serialized = await invoke<string>('read_vault', { vaultId });
    const vaultData = deserializeVault(serialized);
    const decryptedBytes = await decryptVault(vaultData, masterPassword);
    const parsed = JSON.parse(new TextDecoder().decode(decryptedBytes)) as VaultData;
    return { vault: parsed, masterPassword };
  } catch {
    return null;
  }
}

function generateRecoveryWords(): string {
  const wordlist = [
    'abacate','abobora','acesso','agulha','alface','amendoim','anel','aranha','arroz','azeite',
    'banana','barco','bateria','bicicleta','bloco','bota','brisa','broto','bruma','bucha',
    'cabelo','cacto','caderno','café','caju','calor','cama','camera','caneca','caneta',
    'capuz','carta','casa','cavalo','cereal','chave','chocolate','chuva','cidade','clima',
    'coberta','coco','colher','colina','cometa','coqueiro','corda','corpo','costa','cozinha',
    'dedo','dente','deserto','diamante','dinheiro','doce','dragao','ducha','duende','elefante',
  ];
  const shuffled = [...wordlist];
  const rand = new Uint32Array(shuffled.length);
  crypto.getRandomValues(rand);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 12).join(' ');
}

async function deriveKeyFromWords(words: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode('lockpin-recovery-v1');
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(words), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.slice().buffer as ArrayBuffer, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVaultData(data: ArrayBuffer, key: CryptoKey): Promise<import('@core/crypto/encryption').EncryptedVaultWithHMAC> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const full = new Uint8Array(ciphertext);
  const authTag = full.slice(full.length - 16);
  const encrypted = full.slice(0, full.length - 16);
  return { encrypted: encrypted.buffer, iv, authTag, hmac: new Uint8Array(32), salt: new Uint8Array(32) };
}

async function decryptVaultData(vaultData: import('@core/crypto/encryption').EncryptedVaultWithHMAC, key: CryptoKey): Promise<ArrayBuffer> {
  const enc = new Uint8Array(vaultData.encrypted);
  const tag = new Uint8Array(vaultData.authTag);
  const fullCiphertext = new Uint8Array([...enc, ...tag]);
  const iv = new Uint8Array(vaultData.iv);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fullCiphertext);
}

export function addItem(vault: VaultData, item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>): VaultData {
  const now = new Date().toISOString();
  const newItem: VaultItem = { ...item, id: generateId(), createdAt: now, updatedAt: now, attachments: [] };
  return { ...vault, items: [...vault.items, newItem] };
}

export function updateItem(vault: VaultData, itemId: string, updates: Partial<VaultItem>): VaultData {
  return {
    ...vault,
    items: vault.items.map(item =>
      item.id === itemId ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
    ),
  };
}

export function deleteItem(vault: VaultData, itemId: string): VaultData {
  const item = vault.items.find(i => i.id === itemId);
  if (!item) return vault;
  const deleted: DeletedItem = { item, deletedAt: new Date().toISOString() };
  return {
    ...vault,
    items: vault.items.filter(i => i.id !== itemId),
    trash: [...vault.trash, deleted],
  };
}

export function restoreItem(vault: VaultData, deleteItemId: string): VaultData {
  const idx = vault.trash.findIndex(d => d.item.id === deleteItemId);
  if (idx === -1) return vault;
  const deleted = vault.trash[idx];
  const newTrash = [...vault.trash];
  newTrash.splice(idx, 1);
  return { ...vault, items: [...vault.items, deleted.item], trash: newTrash };
}

export async function emptyTrash(vault: VaultData): Promise<VaultData> {
  for (const d of vault.trash) {
    await removeAllAttachmentsForItem(d.item.id).catch(() => {});
  }
  return { ...vault, trash: [] };
}

export async function addAttachment(
  vault: VaultData, itemId: string, file: File,
  masterPassword?: string,
): Promise<VaultData> {
  const id = generateId();
  const raw = await file.arrayBuffer();
  let encBytes: ArrayBuffer;
  if (masterPassword) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(masterPassword, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
    const full = new Uint8Array(ciphertext);
    const header = new Uint8Array([...salt, ...iv, ...full]);
    encBytes = header.buffer;
  } else {
    encBytes = raw;
  }
  await invoke('attachment_write', { itemId, attachmentId: id, data: [...new Uint8Array(encBytes)] });
  const att: VaultAttachment = {
    id, name: file.name, mimeType: file.type, size: file.size,
    createdAt: new Date().toISOString(),
  };
  return updateItem(vault, itemId, {
    attachments: [...(vault.items.find(i => i.id === itemId)?.attachments ?? []), att],
  });
}

export async function readAttachmentData(itemId: string, attachmentId: string, masterPassword?: string): Promise<Uint8Array> {
  const raw = new Uint8Array(await invoke<number[]>('attachment_read', { itemId, attachmentId }));
  if (!masterPassword) return raw;
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const ciphertext = raw.slice(28);
  const key = await deriveKey(masterPassword, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(decrypted);
}

export async function removeAttachment(vault: VaultData, itemId: string, attachmentId: string): Promise<VaultData> {
  const item = vault.items.find(i => i.id === itemId);
  if (!item) return vault;
  await invoke('attachment_delete', { itemId, attachmentId });
  return updateItem(vault, itemId, {
    attachments: (item.attachments ?? []).filter(a => a.id !== attachmentId),
  });
}

export async function removeAllAttachmentsForItem(itemId: string): Promise<void> {
  await invoke('attachment_delete_all', { itemId });
}

export function attachmentDiskPath(itemId: string, attachmentId: string): string {
  return `attachments/${itemId}/${attachmentId}.enc`;
}

// ─── Multi-vault Auth ─────────────────────────────────────────────────────────
// vaults.auth format (multi-line):
// {vault_id}|{master_salt}|{master_hash}|{duress_salt}|{duress_hash}|{kill_salt}|{kill_hash}|{dpapi_blob}|{recovery_blob}

interface VaultAuthEntry {
  vaultId: string;
  masterSalt: string;
  masterHash: string;
  duressSalt: string;
  duressHash: string;
  killSalt: string;
  killHash: string;
  dpapiBlob: string;
  recoveryBlob: string;
}

function parseAuthEntry(line: string): VaultAuthEntry | null {
  const parts = line.split('|');
  if (parts.length < 9) return null;
  return {
    vaultId: parts[0],
    masterSalt: parts[1], masterHash: parts[2],
    duressSalt: parts[3], duressHash: parts[4],
    killSalt: parts[5], killHash: parts[6],
    dpapiBlob: parts[7],
    recoveryBlob: parts[8],
  };
}

function serializeAuthEntry(e: VaultAuthEntry): string {
  return [e.vaultId, e.masterSalt, e.masterHash, e.duressSalt, e.duressHash, e.killSalt, e.killHash, e.dpapiBlob, e.recoveryBlob].join('|');
}

async function readAllAuthEntries(): Promise<VaultAuthEntry[]> {
  try {
    const raw = await invoke<string>('read_auth');
    return raw.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(parseAuthEntry)
      .filter(Boolean) as VaultAuthEntry[];
  } catch { return []; }
}

async function writeAuthEntry(entry: VaultAuthEntry): Promise<void> {
  const entries = await readAllAuthEntries();
  const idx = entries.findIndex(e => e.vaultId === entry.vaultId);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  await invoke('write_auth', { data: entries.map(serializeAuthEntry).join('\n') });
}

export type AuthMode = 'master' | 'duress' | 'kill' | 'invalid';

async function hashPassword(password: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64
    ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(32));
  const bits = await deriveBits(password, salt);
  return { hash: btoa(String.fromCharCode(...bits)), salt: btoa(String.fromCharCode(...salt)) };
}

export async function checkAuthMode(password: string): Promise<{ mode: AuthMode; vaultId: string | null }> {
  const entries = await readAllAuthEntries();
  for (const entry of entries) {
    const mkHash = await hashPassword(password, entry.masterSalt);
    if (mkHash.hash === entry.masterHash) return { mode: 'master', vaultId: entry.vaultId };
    if (entry.duressSalt) {
      const dHash = await hashPassword(password, entry.duressSalt);
      if (dHash.hash === entry.duressHash) return { mode: 'duress', vaultId: entry.vaultId };
    }
    if (entry.killSalt) {
      const kHash = await hashPassword(password, entry.killSalt);
      if (kHash.hash === entry.killHash) return { mode: 'kill', vaultId: entry.vaultId };
    }
  }
  return { mode: 'invalid', vaultId: null };
}

export async function saveAuthInfo(
  vaultId: string,
  masterPassword: string,
  duressPassword?: string,
  killPassword?: string,
  dpapiBlob?: string,
  recoveryBlob?: string,
): Promise<void> {
  const master = await hashPassword(masterPassword);
  let duressSalt = '', duressHash = '';
  let killSalt = '', killHash = '';
  if (duressPassword) {
    const d = await hashPassword(duressPassword);
    duressSalt = d.salt; duressHash = d.hash;
  }
  if (killPassword) {
    const k = await hashPassword(killPassword);
    killSalt = k.salt; killHash = k.hash;
  }
  await writeAuthEntry({
    vaultId,
    masterSalt: master.salt, masterHash: master.hash,
    duressSalt, duressHash,
    killSalt, killHash,
    dpapiBlob: dpapiBlob || '',
    recoveryBlob: recoveryBlob || '',
  });
}

export async function getRecoveryBlob(vaultId: string): Promise<string | null> {
  const entries = await readAllAuthEntries();
  const entry = entries.find(e => e.vaultId === vaultId);
  return entry?.recoveryBlob || null;
}

export async function getDpapiMasterKey(vaultId: string): Promise<string | null> {
  const entries = await readAllAuthEntries();
  const entry = entries.find(e => e.vaultId === vaultId);
  return entry?.dpapiBlob || null;
}

export async function storeDpapiMasterKey(vaultId: string, protectedKey: string): Promise<void> {
  const entries = await readAllAuthEntries();
  const entry = entries.find(e => e.vaultId === vaultId);
  if (!entry) return;
  entry.dpapiBlob = protectedKey;
  await invoke('write_auth', { data: entries.map(serializeAuthEntry).join('\n') });
}

export async function deleteAuthInfo(vaultId: string): Promise<void> {
  await invoke('delete_auth', { vaultId });
}

// Find and unlock a vault using recovery words (tries all vaults)
export async function findVaultByRecoveryWords(recoveryWords: string): Promise<{ vault: VaultData; masterPassword: string; vaultId: string } | null> {
  const entries = await readAllAuthEntries();
  for (const entry of entries) {
    if (!entry.recoveryBlob) continue;
    try {
      const partialVault: VaultData = {
        items: [], collections: [], organizations: [], auditLogs: [], folders: [], trash: [], version: 1,
        recoveryKey: { encryptedMasterKey: entry.recoveryBlob, salt: '', hint: '', createdAt: '' },
      };
      const result = await recoverVault(recoveryWords, partialVault, entry.vaultId);
      if (result) return { ...result, vaultId: entry.vaultId };
    } catch { continue; }
  }
  return null;
}

// ─── Field-level obfuscation ─────────────────────────────────────────────────

export interface EncryptedField {
  data: string;
}

export async function encryptField(key: CryptoKey, value: string): Promise<EncryptedField> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  const enc = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  const ivB64 = btoa(String.fromCharCode(...iv));
  return { data: `${ivB64}:${enc}` };
}

export async function decryptField(key: CryptoKey, field: EncryptedField): Promise<string> {
  const [ivB64, encB64] = field.data.split(':');
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encB64), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export function obfuscateVault(vault: VaultData): VaultData {
  return {
    ...vault,
    items: vault.items.map(item => ({
      ...item,
      password: '',
      totpSeed: '',
      card: item.card ? { ...item.card, number: '', cvc: '' } : undefined,
      identity: item.identity ? { ...item.identity, document: '', email: '' } : undefined,
    })),
  };
}

export function searchItems(vault: VaultData, query: string): VaultItem[] {
  if (!query) return vault.items;
  const q = query.toLowerCase();
  return vault.items.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.username?.toLowerCase().includes(q) ||
    item.url?.toLowerCase().includes(q) ||
    item.tags.some(tag => tag.toLowerCase().includes(q))
  );
}

export function updatePassword(vault: VaultData, itemId: string, newPassword: string): VaultData {
  return updateItem(vault, itemId, { password: newPassword });
}
