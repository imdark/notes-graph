/**
 * Read a .zip in the browser with no library: the central directory gives
 * every entry's offset and method, and DecompressionStream('deflate-raw')
 * inflates the deflated ones. Stored (method 0) and deflated (method 8)
 * entries only; zip64 archives and encrypted entries are refused with a
 * plain message. Plugins are a handful of small files, so this is enough.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEndOfCentralDirectory(view) {
  // The record is at least 22 bytes and may be followed by a comment of up to
  // 65535 bytes; scan back for its signature.
  const min = Math.max(0, view.byteLength - 22 - 65535);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new Error('That file is not a zip archive.');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error(
      'This browser cannot inflate zip entries (no DecompressionStream). Pick the plugin folder instead.'
    );
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `{ [path]: Uint8Array }` for every file entry in the archive. */
export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) {
    throw new Error(
      'zip64 archives are not supported; zip the folder again with fewer or smaller files.'
    );
  }
  const decoder = new TextDecoder();
  const files = {};
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) {
      throw new Error('The zip archive is damaged (bad central directory).');
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // a directory
    if (flags & 0x1)
      throw new Error(
        `${name} is encrypted; zips must not be password-protected.`
      );
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error('The zip archive is damaged (bad local header).');
    }
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    const data = bytes.subarray(start, start + compressedSize);
    if (method === 0) files[name] = new Uint8Array(data);
    else if (method === 8) files[name] = await inflateRaw(data);
    else
      throw new Error(
        `${name} uses an unsupported compression method (${method}).`
      );
  }
  return files;
}

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\.git\/)/;

/**
 * The plugin's files with the archive's top folder stripped: a zip of the
 * folder itself has `manifest.json` at the root; a zip *of* the folder has it
 * under one top directory. Anything else is refused.
 */
export function pluginFilesFrom(entries) {
  const paths = Object.keys(entries).filter(p => !IGNORED.test(p));
  if (paths.includes('manifest.json')) {
    return Object.fromEntries(paths.map(p => [p, entries[p]]));
  }
  const tops = new Set(paths.map(p => p.split('/')[0]));
  if (tops.size === 1) {
    const [top] = tops;
    const inner = paths.filter(p => p.startsWith(`${top}/`));
    const stripped = Object.fromEntries(
      inner.map(p => [p.slice(top.length + 1), entries[p]])
    );
    if ('manifest.json' in stripped) return stripped;
  }
  throw new Error(
    'No manifest.json found: zip the plugin folder so manifest.json is at its root (or one folder down).'
  );
}
