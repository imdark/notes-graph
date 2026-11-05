import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { DeveloperStore } from './developers';
import {
  canonicalDigest,
  keyIdOf,
  parseRawPublicKey,
  verifyDeveloperSignature,
} from './signing';

/** A developer's key pair as the browser makes it: raw public, PKCS8 private. */
function devKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const raw = spki.subarray(spki.length - 32);
  return { raw, privateKey };
}

describe('canonical digest', () => {
  test('is the sha256 of the manifest then each file name and content hash, sorted', () => {
    const manifest = { id: 'com.acme.x', version: '1.0.0', name: 'x' };
    const files = { 'b.js': 'export default 1;', 'a.css': 'body{}' };
    const expected = createHash('sha256')
      .update(JSON.stringify(manifest))
      .update('a.css\n')
      .update(createHash('sha256').update('body{}').digest('hex') + '\n')
      .update('b.js\n')
      .update(
        createHash('sha256').update('export default 1;').digest('hex') + '\n'
      )
      .digest();
    expect(canonicalDigest(manifest, files)).toEqual(expected);
  });

  test('a base64 file hashes its decoded bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const a = canonicalDigest(
      {},
      { 'icon.png': { base64: bytes.toString('base64') } }
    );
    const b = createHash('sha256')
      .update('{}')
      .update('icon.png\n')
      .update(createHash('sha256').update(bytes).digest('hex') + '\n')
      .digest();
    expect(a).toEqual(b);
  });

  test('changes with any file or manifest byte', () => {
    const base = canonicalDigest({ id: 'a' }, { 'index.js': 'x' });
    expect(canonicalDigest({ id: 'a' }, { 'index.js': 'y' })).not.toEqual(base);
    expect(canonicalDigest({ id: 'b' }, { 'index.js': 'x' })).not.toEqual(base);
    expect(
      canonicalDigest({ id: 'a' }, { 'index.js': 'x', 'extra.css': '' })
    ).not.toEqual(base);
  });
});

describe('developer signatures', () => {
  test('a signature over the digest verifies with the raw public key', () => {
    const { raw, privateKey } = devKeys();
    const digest = canonicalDigest({ id: 'com.acme.x' }, { 'index.js': 'ok' });
    const signature = sign(null, digest, privateKey).toString('base64');
    expect(verifyDeveloperSignature(raw, digest, signature)).toBe(true);
  });

  test('a wrong key, a tampered digest, or garbage does not verify', () => {
    const { raw, privateKey } = devKeys();
    const other = devKeys();
    const digest = canonicalDigest({ id: 'com.acme.x' }, { 'index.js': 'ok' });
    const signature = sign(null, digest, privateKey).toString('base64');
    expect(verifyDeveloperSignature(other.raw, digest, signature)).toBe(false);
    const tampered = canonicalDigest(
      { id: 'com.acme.x' },
      { 'index.js': 'evil' }
    );
    expect(verifyDeveloperSignature(raw, tampered, signature)).toBe(false);
    expect(verifyDeveloperSignature(raw, digest, 'not base64 at all!!')).toBe(
      false
    );
    expect(verifyDeveloperSignature(raw, digest, undefined)).toBe(false);
  });

  test('raw keys are 32 bytes and get a 16-hex key id', () => {
    const { raw } = devKeys();
    expect(parseRawPublicKey(raw.toString('base64'))).toEqual(raw);
    expect(parseRawPublicKey('AAAA')).toBeNull();
    expect(parseRawPublicKey(42)).toBeNull();
    expect(keyIdOf(raw)).toMatch(/^[0-9a-f]{16}$/);
    expect(keyIdOf(raw)).toBe(
      createHash('sha256').update(raw).digest('hex').slice(0, 16)
    );
  });
});

describe('developer store', () => {
  const tmp = () =>
    `${process.env.TMPDIR ?? '/tmp'}/developers-${process.pid}-${Math.random().toString(16).slice(2)}.json`;

  test('signs a user up with a key and rotates it, keeping the old one', () => {
    const store = new DeveloperStore(tmp());
    const first = devKeys();
    const signed = store.register(
      { id: 'u1', email: 'u1@x' },
      { name: '  Acme  ', publicKey: first.raw.toString('base64') }
    );
    expect('developer' in signed && signed.developer.name).toBe('Acme');
    expect(store.get('u1')?.keys).toHaveLength(1);

    const second = devKeys();
    store.register(
      { id: 'u1' },
      { name: 'Acme Inc', publicKey: second.raw.toString('base64') }
    );
    const dev = store.get('u1')!;
    expect(dev.name).toBe('Acme Inc');
    expect(dev.keys).toHaveLength(2);
    expect(dev.keys[0].retiredAt).toBeTypeOf('number');
    expect(dev.keys[1].retiredAt).toBeUndefined();
    expect(store.byKeyId(keyIdOf(first.raw))?.developer.id).toBe('u1');
  });

  test("refuses a missing name, a bad key, and another developer's key", () => {
    const store = new DeveloperStore(tmp());
    const { raw } = devKeys();
    expect(
      store.register(
        { id: 'u1' },
        { name: '', publicKey: raw.toString('base64') }
      )
    ).toEqual({
      error: 'name is required',
    });
    expect(
      store.register({ id: 'u1' }, { name: 'A', publicKey: 'nope' })
    ).toMatchObject({
      error: expect.stringContaining('Ed25519'),
    });
    store.register(
      { id: 'u1' },
      { name: 'A', publicKey: raw.toString('base64') }
    );
    expect(
      store.register(
        { id: 'u2' },
        { name: 'B', publicKey: raw.toString('base64') }
      )
    ).toEqual({
      error: 'that key is registered to another developer',
    });
  });

  test('persists to its file', () => {
    const file = tmp();
    const { raw } = devKeys();
    new DeveloperStore(file).register(
      { id: 'u1' },
      { name: 'A', publicKey: raw.toString('base64') }
    );
    expect(new DeveloperStore(file).get('u1')?.name).toBe('A');
  });
});
