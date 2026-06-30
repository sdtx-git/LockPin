import { KDF_ITERATIONS, ARGON2_MEM_COST, ARGON2_TIME_COST, ARGON2_PARALLELISM } from '@shared/constants';
import { invoke } from '@tauri-apps/api/core';

export interface EncryptedVaultWithHMAC {
  encrypted: ArrayBuffer;
  iv: Uint8Array;
  salt: Uint8Array;
  authTag: Uint8Array;
  hmac: Uint8Array;
}

export function serializeVault(data: EncryptedVaultWithHMAC): string {
  const b64 = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)));
  const enc = new Uint8Array(data.encrypted).slice().buffer;
  return JSON.stringify({
    encrypted: b64(enc),
    iv: b64(data.iv.slice().buffer),
    salt: b64(data.salt.slice().buffer),
    authTag: b64(data.authTag.slice().buffer),
    hmac: b64(data.hmac.slice().buffer),
  });
}

export function deserializeVault(serialized: string): EncryptedVaultWithHMAC {
  const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const parsed = JSON.parse(serialized);
  return {
    encrypted: fromB64(parsed.encrypted).buffer,
    iv: fromB64(parsed.iv),
    salt: fromB64(parsed.salt),
    authTag: fromB64(parsed.authTag),
    hmac: fromB64(parsed.hmac),
  };
}

export function generateSalt(length = 16): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function deriveBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.slice().buffer as ArrayBuffer,
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

export async function deriveKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.slice().buffer as ArrayBuffer,
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function deriveHMACKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.slice().buffer as ArrayBuffer,
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );
}

export async function argon2DeriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const saltB64 = btoa(String.fromCharCode(...salt));
  const rawKeyB64: string = await invoke('argon2_derive_key', {
    password,
    salt: saltB64,
    memCost: ARGON2_MEM_COST,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
  const rawKey = Uint8Array.from(atob(rawKeyB64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function computeHMAC(key: CryptoKey, data: BufferSource): Promise<Uint8Array> {
  const result = await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, data);
  return new Uint8Array(result);
}

async function verifyHMAC(key: CryptoKey, data: BufferSource, mac: BufferSource): Promise<boolean> {
  return crypto.subtle.verify({ name: 'HMAC', hash: 'SHA-256' }, key, mac, data);
}

export async function encryptVault(data: ArrayBuffer, masterPassword: string): Promise<EncryptedVaultWithHMAC> {
  const salt = generateSalt();
  const key = await deriveKey(masterPassword, salt);
  const hmacKey = await deriveHMACKey(masterPassword, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const full = new Uint8Array(ciphertext);
  const authTag = full.slice(full.length - 16).buffer;
  const encrypted = full.slice(0, full.length - 16).buffer;
  const hmac = await computeHMAC(hmacKey, encrypted);
  return {
    encrypted,
    iv,
    salt,
    authTag: new Uint8Array(authTag),
    hmac,
  };
}

export async function decryptVault(vault: EncryptedVaultWithHMAC, masterPassword: string): Promise<ArrayBuffer> {
  const key = await deriveKey(masterPassword, vault.salt);
  const hmacKey = await deriveHMACKey(masterPassword, vault.salt);
  const enc = new Uint8Array(vault.encrypted);
  const valid = await verifyHMAC(hmacKey, enc, new Uint8Array(vault.hmac));
  if (!valid) throw new Error('HMAC validation failed');
  const tag = new Uint8Array(vault.authTag);
  const fullCiphertext = new Uint8Array([...enc, ...tag]);
  const iv = new Uint8Array(vault.iv);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fullCiphertext);
}

export async function deriveKeyFromPasswordAndSalt(password: string, salt: Uint8Array): Promise<CryptoKey> {
  return deriveKey(password, salt);
}

export function wipeBuffer(buf: Uint8Array): void {
  buf.fill(0);
}

export function wipeString(str: string): void {
  if (typeof str === 'string' && str.length > 0) {
    (str as unknown as Record<string, unknown>).length = 0;
  }
}
