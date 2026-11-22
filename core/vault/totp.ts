import type { VaultItem } from '@core/vault/types';

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpOptions {
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

export interface TotpAccount extends TotpOptions {
  secret: string;
  issuer: string;
  account: string;
}

export const DEFAULT_TOTP: TotpOptions = { algorithm: 'SHA1', digits: 6, period: 30 };
export const TOTP_ALGORITHMS: TotpAlgorithm[] = ['SHA1', 'SHA256', 'SHA512'];
export const TOTP_DIGITS = [6, 7, 8];

const HASH: Record<TotpAlgorithm, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeSecret(value: string): string {
  return value.toUpperCase().replace(/[\s=-]/g, '');
}

function base32Decode(encoded: string): Uint8Array<ArrayBuffer> {
  const clean = normalizeSecret(encoded);
  if (!clean) throw new Error('Empty base32 secret');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsInBuffer = 0;
  for (const c of clean) {
    const idx = ALPHABET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 character: ${c}`);
    buffer = ((buffer << 5) | idx) & 0xffff;
    bitsInBuffer += 5;
    if (bitsInBuffer >= 8) {
      bytes.push((buffer >> (bitsInBuffer - 8)) & 0xff);
      bitsInBuffer -= 8;
    }
  }
  if (bytes.length === 0) throw new Error('Base32 secret too short');
  return new Uint8Array(bytes);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bitsInBuffer = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      out += ALPHABET[(buffer >> (bitsInBuffer - 5)) & 31];
      bitsInBuffer -= 5;
    }
  }
  if (bitsInBuffer > 0) out += ALPHABET[(buffer << (5 - bitsInBuffer)) & 31];
  return out;
}

export function isValidSecret(value: string): boolean {
  try {
    return base32Decode(value).length >= 1;
  } catch {
    return false;
  }
}

function toAlgorithm(value: string | null | undefined): TotpAlgorithm | null {
  const v = (value ?? '').toUpperCase().replace('-', '');
  return TOTP_ALGORITHMS.includes(v as TotpAlgorithm) ? (v as TotpAlgorithm) : null;
}

export function sanitizeOptions(options: Partial<{ algorithm: string; digits: number; period: number }>): TotpOptions {
  const algorithm = toAlgorithm(options.algorithm) ?? DEFAULT_TOTP.algorithm;
  const digits = Number.isInteger(options.digits) && options.digits! >= 6 && options.digits! <= 8 ? options.digits! : DEFAULT_TOTP.digits;
  const period = Number.isInteger(options.period) && options.period! >= 1 && options.period! <= 300 ? options.period! : DEFAULT_TOTP.period;
  return { algorithm, digits, period };
}

export function parseOtpauthUri(uri: string): TotpAccount | null {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'otpauth:' || url.host.toLowerCase() !== 'totp') return null;
  const secret = normalizeSecret(url.searchParams.get('secret') ?? '');
  if (!isValidSecret(secret)) return null;

  const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const [labelIssuer, ...rest] = label.includes(':') ? label.split(':') : ['', label];
  const account = (rest.length ? rest.join(':') : labelIssuer).trim();
  const issuer = (url.searchParams.get('issuer') ?? (rest.length ? labelIssuer : '')).trim();

  const digits = url.searchParams.get('digits');
  const period = url.searchParams.get('period');
  const algorithm = url.searchParams.get('algorithm');
  if (algorithm && !toAlgorithm(algorithm)) return null;

  return {
    secret,
    issuer,
    account,
    ...sanitizeOptions({
      algorithm: algorithm ?? undefined,
      digits: digits ? Number(digits) : undefined,
      period: period ? Number(period) : undefined,
    }),
  };
}

export async function generateTOTP(seed: string, timestamp: number = Date.now(), options: TotpOptions = DEFAULT_TOTP): Promise<string> {
  let counter = Math.floor(timestamp / 1000 / options.period);
  const message = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    message[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const key = await crypto.subtle.importKey('raw', base32Decode(seed), { name: 'HMAC', hash: HASH[options.algorithm] }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** options.digits).toString().padStart(options.digits, '0');
}

export function getTOTPRemainingSeconds(period: number = DEFAULT_TOTP.period): number {
  return period - Math.floor((Date.now() / 1000) % period);
}

export function totpOptionsOf(item: Pick<VaultItem, 'totpOptions'>): TotpOptions {
  return item.totpOptions ? sanitizeOptions(item.totpOptions) : DEFAULT_TOTP;
}

export async function computeTOTP(item: VaultItem): Promise<string | null> {
  if (!item.totpSeed) return null;
  try {
    return await generateTOTP(item.totpSeed, Date.now(), totpOptionsOf(item));
  } catch {
    return null;
  }
}
