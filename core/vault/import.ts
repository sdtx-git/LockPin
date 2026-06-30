import type { VaultData, VaultItem } from './types';
import { generateId } from '@shared/utils';

interface CsvRow {
  name?: string;
  url?: string;
  username?: string;
  password?: string;
  note?: string;
  totp?: string;
  folder?: string;
  type?: string;
}

export function parseBitwardenCsv(csv: string): Partial<VaultItem>[] {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const items: Partial<VaultItem>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(headers, lines[i]);
    if (!row.name) continue;
    items.push(rowToItem(row));
  }
  return items;
}

export function parseChromeCsv(csv: string): Partial<VaultItem>[] {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const items: Partial<VaultItem>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(headers, lines[i]);
    if (!row.name) continue;
    items.push(rowToItem(row));
  }
  return items;
}

export function parseGenericCsv(csv: string): Partial<VaultItem>[] {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  const items: Partial<VaultItem>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    if (!row.title && !row.name) continue;
    items.push({
      type: 'password',
      title: row.title || row.name || '',
      url: row.url || row.website || '',
      username: row.username || row.user || row.email || '',
      password: row.password || '',
      note: row.note || row.notes || '',
      tags: row.folder ? [row.folder] : [],
    } as Partial<VaultItem>);
  }
  return items;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvRow(headers: string[], line: string): CsvRow {
  const h = headers.map(x => x.toLowerCase().trim());
  const v = parseCsvLine(line);
  const row: Record<string, string> = {};
  h.forEach((key, idx) => { row[key] = v[idx] ?? ''; });
  return row as unknown as CsvRow;
}

function rowToItem(row: CsvRow): Partial<VaultItem> {
  return {
    type: row.type === 'note' ? 'note' : row.totp ? 'totp' : 'password',
    title: row.name || '',
    url: row.url || '',
    username: row.username || '',
    password: row.password || '',
    note: row.note || '',
    totpSeed: row.totp || undefined,
    tags: row.folder ? [row.folder] : [],
  } as Partial<VaultItem>;
}

export function importItems(vault: VaultData, items: Partial<VaultItem>[]): VaultData {
  const newItems: VaultItem[] = items.map(item => ({
    id: generateId(),
    type: item.type || 'password',
    title: item.title || 'Imported',
    url: item.url || '',
    username: item.username || '',
    password: item.password || '',
    totpSeed: item.totpSeed || undefined,
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
