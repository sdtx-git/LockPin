import type { VaultData, VaultItem } from './types';
import { generateId } from '@shared/utils';
import { base32Encode, isValidSecret, normalizeSecret, parseOtpauthUri, sanitizeOptions } from './totp';
import type { TotpAccount } from './totp';

export interface ImportResult {
  items: Partial<VaultItem>[];
  skipped: number;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim()); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) return [];
  const keys = header.map(h => h.toLowerCase().trim());
  return rows.map(values => Object.fromEntries(keys.map((k, i) => [k, values[i] ?? ''])));
}

function totpItem(a: TotpAccount, title?: string): Partial<VaultItem> {
  return {
    type: 'totp',
    title: title || a.issuer || a.account || 'Autenticador',
    username: a.account,
    totpSeed: a.secret,
    totpOptions: { algorithm: a.algorithm, digits: a.digits, period: a.period },
    tags: [],
  };
}

function totpFromValue(value: string): TotpAccount | null {
  const text = value.trim();
  if (!text) return null;
  if (text.toLowerCase().startsWith('otpauth://')) return parseOtpauthUri(text);
  const secret = normalizeSecret(text);
  return isValidSecret(secret) ? { secret, issuer: '', account: '', ...sanitizeOptions({}) } : null;
}

export function parseBitwardenCsv(csv: string): Partial<VaultItem>[] {
  const items: Partial<VaultItem>[] = [];
  for (const r of csvRecords(csv)) {
    const title = r.name;
    if (!title) continue;
    const tags = r.folder ? [r.folder] : [];
    if (r.type === 'note') {
      items.push({ type: 'note', title, note: r.notes || '', tags });
      continue;
    }
    const username = r.login_username || r.username || '';
    items.push({
      type: 'password',
      title,
      url: r.login_uri || r.url || '',
      username,
      password: r.login_password || r.password || '',
      note: r.notes || r.note || '',
      tags,
    });
    const totp = totpFromValue(r.login_totp || r.totp || '');
    if (totp) items.push({ ...totpItem({ ...totp, account: totp.account || username }, title), url: r.login_uri || '', tags });
  }
  return items;
}

export function parseChromeCsv(csv: string): Partial<VaultItem>[] {
  return csvRecords(csv)
    .filter(r => r.name)
    .map(r => ({
      type: 'password',
      title: r.name,
      url: r.url || '',
      username: r.username || '',
      password: r.password || '',
      note: r.note || '',
      tags: [],
    } as Partial<VaultItem>));
}

export function parseGenericCsv(csv: string): Partial<VaultItem>[] {
  const items: Partial<VaultItem>[] = [];
  for (const row of csvRecords(csv)) {
    const title = row.title || row.name || row['serviço'] || '';
    if (!title) continue;
    const username = row.username || row.user || row.email || row['usuário'] || '';
    items.push({
      type: 'password',
      title,
      url: row.url || row.website || '',
      username: username === 'N/A' ? '' : username,
      password: row.password || row.senha || '',
      note: row.note || row.notes || '',
      tags: row.folder ? [row.folder] : [],
    } as Partial<VaultItem>);
  }
  return items;
}

// ─── Autenticadores ───────────────────────────────────────────────────────────

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('O conteúdo não é um JSON válido.');
  }
}

export function parseAegisJson(text: string): ImportResult {
  const json = parseJson(text) as { db?: unknown };
  if (typeof json.db === 'string') throw new Error('Este backup do Aegis está cifrado. No Aegis, exporte sem criptografia e tente de novo.');
  const entries = (json.db as { entries?: Array<{ type?: string; name?: string; issuer?: string; info?: { secret?: string; algo?: string; digits?: number; period?: number } }> })?.entries;
  if (!Array.isArray(entries)) throw new Error('Não parece um backup do Aegis.');
  const items: Partial<VaultItem>[] = [];
  let skipped = 0;
  for (const e of entries) {
    const secret = normalizeSecret(e.info?.secret ?? '');
    if (e.type !== 'totp' || !isValidSecret(secret)) { skipped++; continue; }
    items.push(totpItem({
      secret, issuer: e.issuer ?? '', account: e.name ?? '',
      ...sanitizeOptions({ algorithm: e.info?.algo, digits: e.info?.digits, period: e.info?.period }),
    }));
  }
  return { items, skipped };
}

export function parse2fasJson(text: string): ImportResult {
  const json = parseJson(text) as { services?: unknown; servicesEncrypted?: unknown };
  const services = json.services as Array<{ name?: string; secret?: string; otp?: { account?: string; issuer?: string; digits?: number; period?: number; algorithm?: string; tokenType?: string } }> | undefined;
  if (json.servicesEncrypted && !(Array.isArray(services) && services.length)) {
    throw new Error('Este backup do 2FAS está protegido por senha. No 2FAS, exporte sem senha e tente de novo.');
  }
  if (!Array.isArray(services)) throw new Error('Não parece um backup do 2FAS.');
  const items: Partial<VaultItem>[] = [];
  let skipped = 0;
  for (const s of services) {
    const secret = normalizeSecret(s.secret ?? '');
    const type = (s.otp?.tokenType ?? 'TOTP').toUpperCase();
    if (type !== 'TOTP' || !isValidSecret(secret)) { skipped++; continue; }
    items.push(totpItem({
      secret, issuer: s.otp?.issuer ?? s.name ?? '', account: s.otp?.account ?? '',
      ...sanitizeOptions({ algorithm: s.otp?.algorithm, digits: s.otp?.digits, period: s.otp?.period }),
    }, s.name));
  }
  return { items, skipped };
}

// Google Authenticator: otpauth-migration://offline?data=<protobuf em base64>
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let factor = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error('Dados de migração incompletos.');
    const byte = buf[pos++];
    value += (byte & 0x7f) * factor;
    if ((byte & 0x80) === 0) return [value, pos];
    factor *= 128;
  }
  throw new Error('Dados de migração inválidos.');
}

function readFields(buf: Uint8Array): Array<{ field: number; value: number | Uint8Array }> {
  const fields: Array<{ field: number; value: number | Uint8Array }> = [];
  let pos = 0;
  while (pos < buf.length) {
    let key: number;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      let v: number;
      [v, pos] = readVarint(buf, pos);
      fields.push({ field, value: v });
    } else if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error('Dados de migração incompletos.');
      fields.push({ field, value: buf.slice(pos, pos + len) });
      pos += len;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error('Dados de migração inválidos.');
    }
  }
  return fields;
}

export function parseGoogleMigration(uri: string): ImportResult {
  let data: string | null = null;
  try {
    const url = new URL(uri.trim());
    if (url.protocol === 'otpauth-migration:') data = url.searchParams.get('data');
  } catch {
    data = null;
  }
  if (!data) throw new Error('Link de migração do Google Authenticator inválido.');
  const bytes = Uint8Array.from(atob(data.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  const decoder = new TextDecoder();
  const algorithms: Record<number, 'SHA1' | 'SHA256' | 'SHA512'> = { 0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' };
  const items: Partial<VaultItem>[] = [];
  let skipped = 0;
  for (const top of readFields(bytes)) {
    if (top.field !== 1 || !(top.value instanceof Uint8Array)) continue;
    const p: Record<number, number | Uint8Array> = {};
    for (const f of readFields(top.value)) p[f.field] = f.value;
    const secretBytes = p[1] instanceof Uint8Array ? p[1] : null;
    const algorithm = algorithms[(p[4] as number) ?? 0];
    const type = (p[6] as number) ?? 2;
    if (!secretBytes || !algorithm || (type !== 2 && type !== 0)) { skipped++; continue; }
    const rawName = p[2] instanceof Uint8Array ? decoder.decode(p[2]) : '';
    const issuer = p[3] instanceof Uint8Array ? decoder.decode(p[3]) : '';
    const account = issuer && rawName.startsWith(`${issuer}:`) ? rawName.slice(issuer.length + 1) : rawName;
    items.push(totpItem({
      secret: base32Encode(secretBytes), issuer, account: account.trim(),
      ...sanitizeOptions({ algorithm, digits: p[5] === 2 ? 8 : 6, period: 30 }),
    }));
  }
  return { items, skipped };
}

export function parseOtpauthList(text: string): ImportResult {
  const items: Partial<VaultItem>[] = [];
  let skipped = 0;
  for (const line of text.split(/\s+/).filter(Boolean)) {
    if (line.toLowerCase().startsWith('otpauth-migration://')) {
      const result = parseGoogleMigration(line);
      items.push(...result.items);
      skipped += result.skipped;
      continue;
    }
    const account = parseOtpauthUri(line);
    if (account) items.push(totpItem(account));
    else skipped++;
  }
  return { items, skipped };
}

// ─── Gravação ─────────────────────────────────────────────────────────────────

export function importItems(vault: VaultData, items: Partial<VaultItem>[]): VaultData {
  const newItems: VaultItem[] = items.map(item => ({
    id: generateId(),
    type: item.type || 'password',
    title: item.title || 'Imported',
    url: item.url || '',
    username: item.username || '',
    password: item.password || '',
    totpSeed: item.totpSeed || undefined,
    totpOptions: item.totpOptions,
    note: item.note || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: item.tags || [],
    favorite: false,
    ownerId: '',
    collectionIds: [],
    sharedWith: [],
    attachments: [],
  }));
  return { ...vault, items: [...vault.items, ...newItems] };
}
