/**
 * Reversible at-rest encryption for crawler secrets (e.g. a Slack token).
 *
 * The AES-GCM key is generated once and kept in device-local `localStorage`,
 * which does NOT sync through the Yjs workspace DB or travel in exports — so an
 * encrypted token stored in the (syncable, exportable) view config is useless
 * without the local key. Trade-off: the token doesn't decrypt on another
 * device, so it must be re-entered there (which is also more secure).
 */
const KEY_STORAGE = 'notesgraph:virtual-views:secret-key';
const ENC_PREFIX = 'enc:';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const store = globalThis.localStorage;
  let raw = store?.getItem(KEY_STORAGE) ?? null;
  let bytes: Uint8Array<ArrayBuffer>;
  if (raw) {
    bytes = fromBase64(raw);
  } else {
    bytes = crypto.getRandomValues(new Uint8Array(32));
    raw = toBase64(bytes);
    store?.setItem(KEY_STORAGE, raw);
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return ENC_PREFIX + toBase64(combined);
}

export async function decryptSecret(value: string): Promise<string> {
  // Back-compat: values stored before encryption are returned as-is.
  if (!value.startsWith(ENC_PREFIX)) {
    return value;
  }
  const combined = fromBase64(value.slice(ENC_PREFIX.length));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await getKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}
