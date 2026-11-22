import { describe, it, expect } from 'vitest';
import { parseAegisJson, parse2fasJson, parseBitwardenCsv, parseGoogleMigration, parseOtpauthList, parseGenericCsv } from './import';
import { base32Encode, generateTOTP, totpOptionsOf } from './totp';
import type { VaultItem } from './types';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

async function codeAt59(item: Partial<VaultItem>) {
  return generateTOTP(item.totpSeed!, 59_000, totpOptionsOf(item));
}

describe('Bitwarden CSV', () => {
  const csv = [
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
    `Trabalho,,login,GitHub,"linha 1\nlinha 2, com vírgula",,0,https://github.com,dev@exemplo.com,"s3n,h@",otpauth://totp/GitHub:dev?secret=${SECRET}&issuer=GitHub`,
    `,,login,Gmail,,,0,https://mail.google.com,ana@exemplo.com,outra,${SECRET}`,
    ',,note,Nota segura,conteúdo da nota,,0,,,,',
  ].join('\n');
  const items = parseBitwardenCsv(csv);

  it('traz usuário, senha, URL, notas com quebra de linha e pasta', () => {
    expect(items[0]).toMatchObject({
      type: 'password', title: 'GitHub', url: 'https://github.com', username: 'dev@exemplo.com',
      password: 's3n,h@', note: 'linha 1\nlinha 2, com vírgula', tags: ['Trabalho'],
    });
  });

  it('login com TOTP gera também um item de autenticador', async () => {
    const totps = items.filter(i => i.type === 'totp');
    expect(totps.map(i => i.title)).toEqual(['GitHub', 'Gmail']);
    expect(totps[1].username).toBe('ana@exemplo.com');
    for (const t of totps) expect(await codeAt59(t)).toBe('287082');
  });

  it('nota segura vira nota', () => {
    expect(items.find(i => i.type === 'note')).toMatchObject({ title: 'Nota segura', note: 'conteúdo da nota' });
  });
});

describe('CSV genérico (CypherNest)', () => {
  it('continua lendo cabeçalhos em português', () => {
    const items = parseGenericCsv('Serviço,Usuário,Senha\nBanco,N/A,abc');
    expect(items[0]).toMatchObject({ title: 'Banco', username: '', password: 'abc' });
  });
});

describe('Aegis', () => {
  it('importa TOTP com parâmetros e ignora HOTP', async () => {
    const json = JSON.stringify({ version: 1, header: { slots: null, params: null }, db: { version: 3, entries: [
      { type: 'totp', name: 'dev@exemplo.com', issuer: 'GitHub', info: { secret: SECRET, algo: 'SHA1', digits: 6, period: 30 } },
      { type: 'hotp', name: 'x', issuer: 'y', info: { secret: SECRET, algo: 'SHA1', digits: 6, counter: 1 } },
    ] } });
    const { items, skipped } = parseAegisJson(json);
    expect(skipped).toBe(1);
    expect(items[0]).toMatchObject({ type: 'totp', title: 'GitHub', username: 'dev@exemplo.com' });
    expect(await codeAt59(items[0])).toBe('287082');
  });

  it('avisa quando o backup está cifrado', () => {
    expect(() => parseAegisJson(JSON.stringify({ header: { slots: [{}] }, db: 'base64cifrado' }))).toThrow(/cifrado/);
  });
});

describe('2FAS', () => {
  it('importa serviços TOTP', async () => {
    const json = JSON.stringify({ schemaVersion: 4, services: [
      { name: 'GitHub', secret: SECRET, otp: { account: 'dev', issuer: 'GitHub', digits: 6, period: 30, algorithm: 'SHA1', tokenType: 'TOTP' } },
      { name: 'Steam', secret: SECRET, otp: { tokenType: 'STEAM' } },
    ] });
    const { items, skipped } = parse2fasJson(json);
    expect(skipped).toBe(1);
    expect(items[0]).toMatchObject({ title: 'GitHub', username: 'dev' });
    expect(await codeAt59(items[0])).toBe('287082');
  });

  it('avisa quando o backup tem senha', () => {
    expect(() => parse2fasJson(JSON.stringify({ services: [], servicesEncrypted: 'abc' }))).toThrow(/senha/);
  });
});

describe('Google Authenticator (otpauth-migration)', () => {
  const bytes = (s: string) => Array.from(new TextEncoder().encode(s));
  const field = (tag: number, payload: number[]) => [tag, payload.length, ...payload];
  const secretBytes = Array.from(new TextEncoder().encode('12345678901234567890'));
  const params = [
    ...field(0x0a, secretBytes),
    ...field(0x12, bytes('GitHub:dev@exemplo.com')),
    ...field(0x1a, bytes('GitHub')),
    0x20, 0x01, 0x28, 0x01, 0x30, 0x02,
  ];
  const hotp = [...field(0x0a, secretBytes), ...field(0x12, bytes('contador')), 0x30, 0x01];
  const payload = [...field(0x0a, params), ...field(0x0a, hotp), 0x10, 0x01];
  const data = btoa(String.fromCharCode(...payload));
  const uri = `otpauth-migration://offline?data=${encodeURIComponent(data)}`;

  it('decodifica contas TOTP e ignora HOTP', async () => {
    const { items, skipped } = parseGoogleMigration(uri);
    expect(skipped).toBe(1);
    expect(items[0]).toMatchObject({ type: 'totp', title: 'GitHub', username: 'dev@exemplo.com', totpSeed: base32Encode(new Uint8Array(secretBytes)) });
    expect(await codeAt59(items[0])).toBe('287082');
  });

  it('lista de links mistura otpauth e migração', () => {
    const { items } = parseOtpauthList(`otpauth://totp/Gmail:ana?secret=${SECRET}\n${uri}\nlixo`);
    expect(items.map(i => i.title)).toEqual(['Gmail', 'GitHub']);
  });

  it('recusa link inválido', () => {
    expect(() => parseGoogleMigration('otpauth-migration://offline')).toThrow();
  });
});
