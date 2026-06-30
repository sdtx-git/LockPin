import type { VaultItem } from '@core/vault/types';

const TOTP_INTERVAL = 30;
const TOTP_DIGITS = 6;

function base32Decode(encoded: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = encoded.toUpperCase().split('').map((c) => {
    const idx = alphabet.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 character: ${c}`);
    return idx;
  });

  const bytes: number[] = [];
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const b of bits) {
    buffer = (buffer << 5) | b;
    bitsInBuffer += 5;
    if (bitsInBuffer >= 8) {
      bytes.push((buffer >> (bitsInBuffer - 8)) & 0xff);
      bitsInBuffer -= 8;
    }
  }

  return new Uint8Array(bytes);
}

async function hmacSha1(key: Uint8Array<ArrayBuffer>, message: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

function dynamicTruncate(hmac: Uint8Array): number {
  const offset = hmac[hmac.length - 1] & 0x0f;
  return (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  );
}

export async function generateTOTP(seed: string, timestamp: number = Date.now()): Promise<string> {
  let time = Math.floor(timestamp / 1000 / TOTP_INTERVAL);
  const timeBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    timeBytes[i] = time & 0xff;
    time = Math.floor(time / 256);
  }

  const key = base32Decode(seed);
  const hmac = await hmacSha1(key, timeBytes);
  const otp = dynamicTruncate(hmac) % 10 ** TOTP_DIGITS;

  return otp.toString().padStart(TOTP_DIGITS, '0');
}

export function getTOTPRemainingSeconds(): number {
  const now = Date.now();
  return TOTP_INTERVAL - Math.floor((now / 1000) % TOTP_INTERVAL);
}

export async function computeTOTP(item: VaultItem): Promise<string | null> {
  if (!item.totpSeed) return null;
  try {
    return await generateTOTP(item.totpSeed, Date.now());
  } catch {
    return null;
  }
}
