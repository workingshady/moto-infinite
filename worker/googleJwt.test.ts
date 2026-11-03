import { beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_CLIENT_ID } from '../shared/auth';
import { JwksCache, verifyGoogleIdToken } from './googleJwt';

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const b64url = (b: Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let good: CryptoKeyPair, other: CryptoKeyPair, jwk: JsonWebKey;
const NOW = Date.UTC(2026, 10, 3, 12);
const sec = Math.floor(NOW / 1000);

async function sign(claims: Record<string, unknown>, opts: { kid?: string; key?: CryptoKey; alg?: string } = {}) {
  const head = b64url(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, opts.key ?? good.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
const claims = (over: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT_ID, sub: '1234567890', name: 'Test Rider', exp: sec + 3600, iat: sec - 10, ...over });

function cache(counter = { n: 0 }) {
  return new JwksCache(async () => { counter.n++; return { keys: [{ ...jwk, kid: 'k1' } as JsonWebKey], maxAge: 3600 }; }, () => NOW);
}

beforeAll(async () => {
  const gen = () => crypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  good = await gen();
  other = await gen();
  jwk = (await crypto.subtle.exportKey('jwk', good.publicKey)) as JsonWebKey;
});

describe('verifyGoogleIdToken', () => {
  it('accepts a correctly signed token for our client id', async () => {
    const c = await verifyGoogleIdToken(await sign(claims()), cache(), { now: NOW });
    expect(c.sub).toBe('1234567890');
    expect(c.name).toBe('Test Rider');
  });

  it('accepts both Google issuer spellings', async () => {
    await expect(verifyGoogleIdToken(await sign(claims({ iss: 'accounts.google.com' })), cache(), { now: NOW })).resolves.toBeTruthy();
  });

  it('rejects a wrong audience, issuer, expiry or issue time', async () => {
    const j = cache();
    await expect(verifyGoogleIdToken(await sign(claims({ aud: 'someone-else.apps.googleusercontent.com' })), j, { now: NOW })).rejects.toThrow('audience');
    await expect(verifyGoogleIdToken(await sign(claims({ iss: 'https://evil.example' })), j, { now: NOW })).rejects.toThrow('issuer');
    await expect(verifyGoogleIdToken(await sign(claims({ exp: sec - 600 })), j, { now: NOW })).rejects.toThrow('expired');
    await expect(verifyGoogleIdToken(await sign(claims({ iat: sec + 3600 })), j, { now: NOW })).rejects.toThrow('future');
  });

  it('tolerates a small clock skew', async () => {
    await expect(verifyGoogleIdToken(await sign(claims({ exp: sec - 30 })), cache(), { now: NOW })).resolves.toBeTruthy();
  });

  it('rejects a bad signature, a tampered payload, an unknown kid and other algorithms', async () => {
    const j = cache();
    await expect(verifyGoogleIdToken(await sign(claims(), { key: other.privateKey }), j, { now: NOW })).rejects.toThrow('signature');
    const [h, , s] = (await sign(claims())).split('.');
    await expect(verifyGoogleIdToken(`${h}.${b64url(JSON.stringify(claims({ sub: 'attacker' })))}.${s}`, j, { now: NOW })).rejects.toThrow('signature');
    await expect(verifyGoogleIdToken(await sign(claims(), { kid: 'nope' }), j, { now: NOW })).rejects.toThrow('unknown key');
    await expect(verifyGoogleIdToken(await sign(claims(), { alg: 'HS256' }), j, { now: NOW })).rejects.toThrow('algorithm');
    await expect(verifyGoogleIdToken('not.a.jwt', j, { now: NOW })).rejects.toThrow();
    await expect(verifyGoogleIdToken('x'.repeat(5000), j, { now: NOW })).rejects.toThrow();
  });

  it('caches the key set (one fetch for many tokens) and refetches at most once a minute for an unknown kid', async () => {
    const n = { n: 0 }, j = cache(n);
    for (let i = 0; i < 3; i++) await verifyGoogleIdToken(await sign(claims()), j, { now: NOW });
    expect(n.n).toBe(1);
    await expect(verifyGoogleIdToken(await sign(claims(), { kid: 'rotated' }), j, { now: NOW })).rejects.toThrow('unknown key');
    expect(n.n).toBe(1); // fetched < 60 s ago
  });
});
