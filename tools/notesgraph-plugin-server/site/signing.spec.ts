import { createHash, createPrivateKey, sign as nodeSign } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  canonicalDigest,
  fileBytes,
  isTextPath,
  keyIdFromRaw,
  signPublish,
  toFileEntry,
  toHex,
  verifyPublish,
} from './signing.js';

/**
 * The digest and key id as the server will recompute them, written out with
 * node's own crypto rather than the module under test.
 */
function referenceDigest(
  manifest: unknown,
  files: Record<string, string | { base64: string }>
): Buffer {
  const hash = createHash('sha256');
  hash.update(Buffer.from(JSON.stringify(manifest), 'utf8'));
  for (const path of Object.keys(files).sort()) {
    const entry = files[path];
    const bytes =
      typeof entry === 'string'
        ? Buffer.from(entry, 'utf8')
        : Buffer.from(entry.base64, 'base64');
    hash.update(Buffer.from(path, 'utf8'));
    hash.update('\n');
    hash.update(createHash('sha256').update(bytes).digest('hex'));
    hash.update('\n');
  }
  return hash.digest();
}

const manifest = {
  id: 'com.example.hello',
  name: 'Hello',
  version: '1.2.3',
  permissions: ['ui', 'agents'],
  entry: { client: 'index.js' },
};

const files = {
  'index.js': 'export default { activate() {} };\n',
  'style.css': 'body { color: red }\n',
  'icon.png': {
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]).toString('base64'),
  },
  'README.md': '# Hello — with a non-ASCII dash\n',
};

describe('canonical digest', () => {
  test('matches a node reference implementation', async () => {
    const digest = await canonicalDigest(manifest, files);
    expect(toHex(digest)).toBe(
      referenceDigest(manifest, files).toString('hex')
    );
  });

  test('is a fixed value for a fixed input', async () => {
    const digest = await canonicalDigest(
      { id: 'a.b', version: '0.0.1' },
      {
        'index.js': 'x',
      }
    );
    // sha256( '{"id":"a.b","version":"0.0.1"}' + 'index.js\n' + sha256hex('x') + '\n' )
    const expected = createHash('sha256')
      .update('{"id":"a.b","version":"0.0.1"}')
      .update('index.js\n')
      .update(createHash('sha256').update('x').digest('hex'))
      .update('\n')
      .digest('hex');
    expect(toHex(digest)).toBe(expected);
  });

  test('depends on manifest key order, as the body is sent', async () => {
    const a = await canonicalDigest({ id: 'x', version: '1' }, {});
    const b = await canonicalDigest({ version: '1', id: 'x' }, {});
    expect(toHex(a)).not.toBe(toHex(b));
  });

  test('is independent of the file map order', async () => {
    const a = await canonicalDigest(manifest, files);
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    const b = await canonicalDigest(manifest, reversed);
    expect(toHex(a)).toBe(toHex(b));
  });

  test('changes when a file byte changes', async () => {
    const a = await canonicalDigest(manifest, files);
    const b = await canonicalDigest(manifest, {
      ...files,
      'index.js': files['index.js'] + ' ',
    });
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('key id', () => {
  test('is the first 16 hex chars of sha256(raw public key)', async () => {
    const raw = new Uint8Array(32).map((_, i) => i * 7);
    const expected = createHash('sha256')
      .update(raw)
      .digest('hex')
      .slice(0, 16);
    expect(await keyIdFromRaw(raw)).toBe(expected);
    expect(expected).toHaveLength(16);
  });
});

describe('signing', () => {
  test('a WebCrypto signature verifies with node, and the reverse', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ]);
    const raw = new Uint8Array(
      await crypto.subtle.exportKey('raw', pair.publicKey)
    );
    const signature = await signPublish(pair.privateKey, manifest, files);
    expect(await verifyPublish(raw, signature, manifest, files)).toBe(true);
    expect(
      await verifyPublish(
        raw,
        signature,
        { ...manifest, version: '9.9.9' },
        files
      )
    ).toBe(false);

    // The same digest signed by node verifies in the module.
    const pkcs8 = Buffer.from(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    );
    const nodeKey = createPrivateKey({
      key: pkcs8,
      format: 'der',
      type: 'pkcs8',
    });
    const nodeSig = nodeSign(
      null,
      referenceDigest(manifest, files),
      nodeKey
    ).toString('base64');
    expect(await verifyPublish(raw, nodeSig, manifest, files)).toBe(true);
  });
});

describe('file entries', () => {
  test('text extensions travel as strings, binaries as base64', () => {
    expect(isTextPath('a/b/index.JS')).toBe(true);
    expect(isTextPath('icon.png')).toBe(false);
    const text = new TextEncoder().encode('hello ✓');
    expect(toFileEntry('readme.md', text)).toBe('hello ✓');
    const png = new Uint8Array([0x89, 0x50, 0xff, 0xfe]);
    const entry = toFileEntry('icon.png', png);
    expect(entry).toEqual({ base64: Buffer.from(png).toString('base64') });
    expect(fileBytes(entry)).toEqual(png);
  });

  test('a .js file that is not UTF-8 goes as base64 so bytes survive', () => {
    const notUtf8 = new Uint8Array([0x61, 0xff, 0xfe, 0x62]);
    const entry = toFileEntry('bad.js', notUtf8);
    expect(typeof entry).toBe('object');
    expect(fileBytes(entry)).toEqual(notUtf8);
  });
});
