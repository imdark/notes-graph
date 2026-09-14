// Prunes dist/ before Capacitor packages it into the APK.
//
// Two categories of dead weight get dropped:
//  - *.js.map — source maps are unusable inside a WebView and added ~60MB.
//    (The bundler no longer emits them for mobile; this also catches stale
//    files from earlier builds since `bundle` doesn't clean the whole dir.)
//  - large .wasm — the onnxruntime-web runtimes (~104MB across duplicated
//    copies). Every consumer (go-board OCR worker, local-image, transformers)
//    sets `env.wasm.wasmPaths` to the jsDelivr CDN, so these bundler-emitted
//    copies are never fetched at runtime. Loaded on demand + HTTP-cached
//    instead. Small wasm (shiki's oniguruma, etc.) stays local.
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('./dist', import.meta.url));
const WASM_SIZE_LIMIT = 5 * 1024 * 1024;

let removed = 0;
let bytes = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    const isMap = entry.name.endsWith('.js.map');
    const isBigWasm =
      entry.name.endsWith('.wasm') && statSync(path).size >= WASM_SIZE_LIMIT;
    if (isMap || isBigWasm) {
      bytes += statSync(path).size;
      removed++;
      console.log(`[prune-dist] removing ${path.slice(DIST.length + 1)}`);
      unlinkSync(path);
    }
  }
}

walk(DIST);
console.log(
  `[prune-dist] removed ${removed} files, ${(bytes / 1024 / 1024).toFixed(1)}MB`
);
