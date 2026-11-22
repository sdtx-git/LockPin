import { describe, it, expect } from 'vitest';
import { base32Encode, generateTOTP, isValidSecret, normalizeSecret, parseOtpauthUri } from './totp';
import type { TotpAlgorithm } from './totp';

const ascii = (s: string) => base32Encode(new TextEncoder().encode(s));
const SECRETS: Record<TotpAlgorithm, string> = {
  SHA1: ascii('12345678901234567890'),
  SHA256: ascii('12345678901234567890123456789012'),
  SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
};

const RFC6238: [number, Record<TotpAlgorithm, string>][] = [
  [59, { SHA1: '94287082', SHA256: '46119246', SHA512: '90693936' }],
  [1111111109, { SHA1: '07081804', SHA256: '68084774', SHA512: '25091201' }],
  [1111111111, { SHA1: '14050471', SHA256: '67062674', SHA512: '99943326' }],
  [1234567890, { SHA1: '89005924', SHA256: '91819424', SHA512: '93441116' }],
  [2000000000, { SHA1: '69279037', SHA256: '90698825', SHA512: '38618901' }],
  [20000000000, { SHA1: '65353130', SHA256: '77737706', SHA512: '47863826' }],
];

describe('RFC 6238', () => {
  for (const [t, codes] of RFC6238) {
    for (const algorithm of Object.keys(codes) as TotpAlgorithm[]) {
      it(`${algorithm} T=${t}`, async () => {
        expect(await generateTOTP(SECRETS[algorithm], t * 1000, { algorithm, digits: 8, period: 30 })).toBe(codes[algorithm]);
      });
    }
  }

  it('padrão de 6 dígitos usa os 6 últimos', async () => {
    expect(await generateTOTP(SECRETS.SHA1, 59_000)).toBe('287082');
  });

  it('período de 60s muda a janela', async () => {
    const at30 = await generateTOTP(SECRETS.SHA1, 1111111109_000, { algorithm: 'SHA1', digits: 6, period: 30 });
    const at60 = await generateTOTP(SECRETS.SHA1, 1111111109_000, { algorithm: 'SHA1', digits: 6, period: 60 });
    expect(at30).toBe('081804');
    expect(at60).not.toBe(at30);
  });
});

describe('semente', () => {
  it('aceita minúsculas, espaços e padding', () => {
    expect(normalizeSecret('gezd gnbv gy3t qojq====')).toBe('GEZDGNBVGY3TQOJQ');
    expect(isValidSecret('gezd gnbv gy3t qojq====')).toBe(true);
  });

  it('recusa vazia e caracteres fora do Base32', () => {
    expect(isValidSecret('')).toBe(false);
    expect(isValidSecret('ABC1')).toBe(false);
    expect(isValidSecret('otpauth://totp/x')).toBe(false);
  });

  it('semente inválida rejeita em vez de gerar código', async () => {
    await expect(generateTOTP('')).rejects.toThrow();
  });

  it('base32 ida e volta', () => {
    expect(base32Encode(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]))).toBe('JBSWY3DP');
  });
});

describe('otpauth://', () => {
  it('lê emissor, conta e padrões', () => {
    const a = parseOtpauthUri(`otpauth://totp/GitHub:dev%40exemplo.com?secret=${SECRETS.SHA1}&issuer=GitHub`);
    expect(a).toMatchObject({ secret: SECRETS.SHA1, issuer: 'GitHub', account: 'dev@exemplo.com', algorithm: 'SHA1', digits: 6, period: 30 });
  });

  it('lê algoritmo, dígitos e período', () => {
    const a = parseOtpauthUri(`otpauth://totp/Banco:ana?secret=${SECRETS.SHA256}&algorithm=SHA256&digits=8&period=60`);
    expect(a).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 60, issuer: 'Banco', account: 'ana' });
  });

  it('recusa HOTP, sem secret e algoritmo desconhecido', () => {
    expect(parseOtpauthUri(`otpauth://hotp/x?secret=${SECRETS.SHA1}&counter=1`)).toBeNull();
    expect(parseOtpauthUri('otpauth://totp/x')).toBeNull();
    expect(parseOtpauthUri(`otpauth://totp/x?secret=${SECRETS.SHA1}&algorithm=MD5`)).toBeNull();
  });
});
