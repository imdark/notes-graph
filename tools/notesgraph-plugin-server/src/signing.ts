/**
 * Developer signatures on submissions. A developer signs up with an Ed25519
 * key they generate in their browser; the private key never leaves them. A
 * submission carries a signature over a canonical digest of the manifest and
 * every file, and the registry verifies it against the key on record before
 * anything is stored. The registry's own key (server.ts) still countersigns
 * what it lists, so an installing app checks one signature, as before.
 *
 * The digest is defined here and mirrored by the site (site/signing.js) and
 * must not change without versioning both:
 *
 *   sha256( utf8(JSON.stringify(manifest))
 *         + for each path in sorted order: utf8(path) + "\n" + hex(sha256(bytes)) + "\n" )
 *
 * and the signature is Ed25519 over those 32 bytes.
 */
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto';

/** A submitted file: UTF-8 text as a string, anything else as base64. */
export type SubmittedFile = string | { base64: string };

/** DER prefix that turns a raw 32-byte Ed25519 public key into SPKI. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function fileBytes(content: SubmittedFile): Buffer {
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  return Buffer.from(content.base64, 'base64');
}

export function canonicalDigest(
  manifest: unknown,
  files: Record<string, SubmittedFile>
): Buffer {
  const hash = createHash('sha256');
  hash.update(Buffer.from(JSON.stringify(manifest), 'utf8'));
  for (const name of Object.keys(files).sort()) {
    hash.update(Buffer.from(name, 'utf8'));
    hash.update('\n');
    hash.update(
      createHash('sha256').update(fileBytes(files[name])).digest('hex')
    );
    hash.update('\n');
  }
  return hash.digest();
}

/** A raw Ed25519 public key as base64 (what WebCrypto exports as 'raw'). */
export function parseRawPublicKey(publicKey: unknown): Buffer | null {
  if (typeof publicKey !== 'string') return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(publicKey.trim(), 'base64');
  } catch {
    return null;
  }
  return raw.length === 32 ? raw : null;
}

/** The short id of a key: the first 16 hex characters of sha256(raw key). */
export function keyIdOf(rawPublicKey: Buffer): string {
  return createHash('sha256').update(rawPublicKey).digest('hex').slice(0, 16);
}

export function verifyDeveloperSignature(
  rawPublicKey: Buffer,
  digest: Buffer,
  signature: unknown
): boolean {
  if (typeof signature !== 'string') return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(null, digest, key, sig);
  } catch {
    return false;
  }
}
