/**
 * The bytes a developer signs when publishing, and the key id the registry
 * knows a key by. Pure functions over WebCrypto, so the same module runs in
 * the browser and under node (tests, the CLI).
 *
 *   digest = SHA-256(
 *     utf8(JSON.stringify(manifest))
 *     + for each file path in sorted order: utf8(path) + "\n" + hex(SHA-256(bytes)) + "\n"
 *   )
 *   signature = Ed25519.sign(privateKey, digest)
 *   keyId     = hex(SHA-256(rawPublicKey)).slice(0, 16)
 *
 * The manifest is hashed exactly as it is sent in the publish body, and the
 * file order is the JS default sort of the paths, so the server can recompute
 * the digest from the body alone.
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

/** Extensions sent as UTF-8 text; everything else travels as `{ base64 }`. */
export const TEXT_EXTENSIONS = [
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.md',
  '.txt',
  '.html',
];

export function isTextPath(path) {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function toHex(bytes) {
  let out = '';
  for (const b of new Uint8Array(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}

export function toBase64(bytes) {
  let s = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export async function sha256(bytes) {
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}

/** The bytes a publish-body file entry stands for. */
export function fileBytes(entry) {
  if (typeof entry === 'string') return encoder.encode(entry);
  if (entry && typeof entry.base64 === 'string')
    return fromBase64(entry.base64);
  throw new Error('a file is neither a string nor { base64 }');
}

/**
 * Turn raw file bytes into a publish-body entry: text as a string, binaries
 * as base64. A text file that is not valid UTF-8 goes as base64 too, so what
 * is signed is always exactly what is stored.
 */
export function toFileEntry(path, bytes) {
  if (isTextPath(path)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      // Round-trip check: the server stores the string's UTF-8 bytes.
      if (encoder.encode(text).length === bytes.length) return text;
    } catch {
      // not UTF-8: fall through
    }
  }
  return { base64: toBase64(bytes) };
}

function concat(parts) {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** The 32-byte digest a developer signs for `{ manifest, files }`. */
export async function canonicalDigest(manifest, files) {
  const parts = [encoder.encode(JSON.stringify(manifest))];
  for (const path of Object.keys(files).sort()) {
    const hash = await sha256(fileBytes(files[path]));
    parts.push(encoder.encode(`${path}\n${toHex(hash)}\n`));
  }
  return sha256(concat(parts));
}

/** How the registry names a public key: the first 16 hex chars of its hash. */
export async function keyIdFromRaw(rawPublicKey) {
  return toHex(await sha256(rawPublicKey)).slice(0, 16);
}

/** Base64 Ed25519 signature over the canonical digest. */
export async function signPublish(privateKey, manifest, files) {
  const digest = await canonicalDigest(manifest, files);
  const signature = await subtle.sign('Ed25519', privateKey, digest);
  return toBase64(signature);
}

/** Check a publish signature against a raw public key; for tests and tools. */
export async function verifyPublish(rawPublicKey, signature, manifest, files) {
  const key = await subtle.importKey('raw', rawPublicKey, 'Ed25519', true, [
    'verify',
  ]);
  const digest = await canonicalDigest(manifest, files);
  return subtle.verify('Ed25519', key, fromBase64(signature), digest);
}
