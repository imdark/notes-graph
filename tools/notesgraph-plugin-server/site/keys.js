/**
 * Developer keys: generated in the browser, kept by the developer. The
 * registry only ever sees the public half.
 */
import { fromBase64, keyIdFromRaw, toBase64 } from './signing.js';

const subtle = globalThis.crypto.subtle;
const KEPT_KEY = 'notesgraph-market:developer-key';

export const KEY_FILE_NAME = 'notesgraph-developer-key.json';

/** Whether this browser can make and use Ed25519 keys. */
export async function ed25519Supported() {
  try {
    await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

/**
 * A fresh key pair as the key file the developer downloads:
 * `{ kind, version, keyId, name, publicKey (raw base64), privateKey (pkcs8 base64), createdAt }`.
 */
export async function generateKeyFile(name) {
  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(
    await subtle.exportKey('pkcs8', pair.privateKey)
  );
  return {
    kind: 'notesgraph-developer-key',
    version: 1,
    keyId: await keyIdFromRaw(raw),
    name,
    publicKey: toBase64(raw),
    privateKey: toBase64(pkcs8),
    createdAt: new Date().toISOString(),
  };
}

/** Parse a key file's text; throws with a plain reason when it is not one. */
export async function parseKeyFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not JSON.');
  }
  if (!data || data.kind !== 'notesgraph-developer-key') {
    throw new Error(`That is not a ${KEY_FILE_NAME} file.`);
  }
  if (
    typeof data.publicKey !== 'string' ||
    typeof data.privateKey !== 'string'
  ) {
    throw new Error('The key file is missing its keys.');
  }
  const raw = fromBase64(data.publicKey);
  const keyId = await keyIdFromRaw(raw);
  if (data.keyId && data.keyId !== keyId) {
    throw new Error(
      'The key file is damaged: its keyId does not match its key.'
    );
  }
  return { ...data, keyId };
}

/** The signing key from a key file, ready for `signPublish`. */
export async function importPrivateKey(keyFile) {
  return subtle.importKey(
    'pkcs8',
    fromBase64(keyFile.privateKey),
    'Ed25519',
    false,
    ['sign']
  );
}

export function downloadKeyFile(keyFile) {
  const blob = new Blob([JSON.stringify(keyFile, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = KEY_FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "Keep on this browser" is off by default: the key then lives only in the
// downloaded file. Everything here is wrapped because storage can be blocked.
export function keptKey() {
  try {
    const raw = localStorage.getItem(KEPT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function keepKey(keyFile) {
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify(keyFile));
    return true;
  } catch {
    return false;
  }
}

export function forgetKey() {
  try {
    localStorage.removeItem(KEPT_KEY);
  } catch {
    // nothing to forget
  }
}
