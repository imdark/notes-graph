# Plugin Market site

The public face of the marketplace sidecar: browse plugins, become a
developer, publish a plugin signed with your own key, follow your
submissions, and (for administrators) review what is pending.

Static files, served by the sidecar itself at `/` with assets under `/site/`.
On prod that is `https://app.notesgraph.com/market/` (Caddy strips the
`/market` prefix); locally `http://localhost:8099/`. No build step: HTML, ES
modules and CSS. No external scripts.

## Files

| file              | what                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `index.html`      | shell: header, nav, `#app`, footer                                                                  |
| `app.js`          | hash router and the pages (`#/`, `#/plugin/<id>`, `#/developer`, `#/publish`, `#/mine`, `#/review`) |
| `api.js`          | the API calls; derives the base path from the page's own path                                       |
| `signing.js`      | the canonical digest, key id, sign/verify (pure, runs in node too)                                  |
| `keys.js`         | key generation, the key file, "keep on this browser"                                                |
| `zip.js`          | reads a `.zip` with `DecompressionStream`, finds the plugin root                                    |
| `style.css`       | the look; light and dark via `prefers-color-scheme`                                                 |
| `signing.spec.ts` | vitest: digest vectors, key id, WebCrypto ↔ node signatures                                         |

## Signing

Developers hold an Ed25519 key generated in the browser. The registry stores
only the public key, named by `keyId = hex(sha256(rawPublicKey))[0:16]`.

A publish body is `{ manifest, files, keyId, signature }` where `files` maps
each path to a UTF-8 string (`.js .mjs .css .json .svg .md .txt .html`) or
`{ base64 }` for anything else, and

```
digest    = SHA-256( utf8(JSON.stringify(manifest))
                     + Σ sorted paths: utf8(path) + "\n" + hex(SHA-256(bytes)) + "\n" )
signature = base64( Ed25519.sign(privateKey, digest) )
```

The server recomputes the digest from the body and verifies the signature
against the developer's registered key. The manifest is hashed exactly as
sent, so its key order matters; the file order does not.

The key file the developer downloads (`notesgraph-developer-key.json`):

```json
{
  "kind": "notesgraph-developer-key",
  "version": 1,
  "keyId": "…16 hex…",
  "name": "Display name",
  "publicKey": "<raw 32 bytes, base64>",
  "privateKey": "<PKCS#8, base64>",
  "createdAt": "2026-11-02T00:00:00.000Z"
}
```

NotesGraph never sees the private key and cannot recover it. "Keep on this
browser" stores the file in `localStorage` and is off by default.

## Sign-in

The site has no sign-in of its own. It is same-origin with the app, so the
app's session cookie reaches `/me`; signed-out visitors are sent to the app to
sign in and come back.

## Browser support

Key generation needs WebCrypto Ed25519 (Chrome 137+, Safari 17+, Firefox
130+). Reading a `.zip` needs `DecompressionStream('deflate-raw')`; "Pick a
folder" works without it. Zip64 and encrypted archives are refused.

## Tests

```
yarn test tools/notesgraph-plugin-server
```
