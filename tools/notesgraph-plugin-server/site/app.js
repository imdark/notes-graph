/**
 * The marketplace site: browse plugins, become a developer, publish a signed
 * plugin, follow your submissions, review pending ones (admins). A hash
 * router over plain DOM; no framework, no build.
 */
import { api, ApiError, APP_URL } from './api.js';
import {
  downloadKeyFile,
  ed25519Supported,
  forgetKey,
  generateKeyFile,
  importPrivateKey,
  keepKey,
  keptKey,
  KEY_FILE_NAME,
  parseKeyFile,
} from './keys.js';
import { signPublish, toFileEntry } from './signing.js';
import { pluginFilesFrom, readZip } from './zip.js';

const PERMISSIONS = {
  docs: 'Read and write the notes in your workspace.',
  workspace: 'Know which workspace you are in (not its contents).',
  ui: 'Add commands, side panels, settings pages and importers.',
  editor: 'Extend the note editor itself (first-party plugins only).',
  docModes: 'Add a document editing mode (first-party plugins only).',
  hooks: 'Be told when you open or close notes and navigate.',
  commands: 'Register commands other parts of the plugin can run.',
  storage: 'Keep its own settings and small files on this device.',
  backend: "Call the plugin's own server code in the marketplace.",
  net: 'Make network requests from this device.',
  native: 'Use desktop-only features: notifications, a private folder on disk.',
  agents: 'Install agents from the app templates and start agent runs.',
};

const SENSITIVE = new Set(['docs', 'net', 'native', 'agents', 'backend']);

const ID_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const VERSION_RE = /^\d+\.\d+\.\d+/;

const state = {
  user: null,
  developer: null,
  sessionError: null,
};

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const who = document.getElementById('who');

// ---- tiny DOM helpers ------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

function render(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
}

const fmtDate = s => (s ? new Date(s).toLocaleDateString() : '');
const fmtBytes = n =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

function errorText(err) {
  if (err instanceof ApiError) {
    const issues = err.body?.issues;
    if (Array.isArray(issues) && issues.length) {
      return `${err.message}\n${issues
        .map(i => `• ${(i.path ?? []).join('.') || 'manifest'}: ${i.message}`)
        .join('\n')}`;
    }
    if (err.status === 401)
      return 'You are signed out. Sign in to NotesGraph and try again.';
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function errorNote(err) {
  return h('div', { class: 'note error', role: 'alert' }, errorText(err));
}

function chips(permissions) {
  return h(
    'div',
    { class: 'chips' },
    (permissions ?? []).map(p =>
      h(
        'span',
        {
          class: `chip${SENSITIVE.has(p) ? ' warn' : ''}`,
          title: PERMISSIONS[p] ?? 'A permission this site does not know.',
        },
        p
      )
    )
  );
}

function statusBadge(status) {
  return h('span', { class: `status ${status}` }, status);
}

function signInPrompt(why) {
  return h(
    'div',
    { class: 'panel' },
    h('h2', {}, 'Sign in first'),
    h('p', { class: 'muted' }, why),
    h(
      'div',
      { class: 'row' },
      h(
        'a',
        { class: 'button primary', href: APP_URL },
        'Sign in to NotesGraph'
      ),
      h('button', { onclick: () => loadSession().then(route) }, 'Retry')
    )
  );
}

function copyButton(text, label = 'Copy') {
  const btn = h('button', {}, label);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = label), 1500);
    } catch {
      btn.textContent = 'Select and copy';
    }
  });
  return btn;
}

// ---- session ---------------------------------------------------------------

async function loadSession() {
  try {
    const me = await api.me();
    state.user = me.user ?? null;
    state.developer = me.developer ?? null;
    state.sessionError = null;
  } catch (err) {
    state.user = null;
    state.developer = null;
    state.sessionError = err;
  }
  renderChrome();
}

function renderChrome() {
  // Becoming a developer is offered to everyone; signed out, its page asks
  // them to sign in first.
  const links = [
    ['#/', 'Browse'],
    ['#/developer', state.developer ? 'Developer' : 'Become a developer'],
  ];
  if (state.user) {
    if (state.developer) {
      links.push(['#/publish', 'Publish'], ['#/mine', 'My plugins']);
    }
    if (state.user.admin) links.push(['#/review', 'Review']);
  }
  const current = location.hash || '#/';
  nav.replaceChildren(
    ...links.map(([href, label]) =>
      h(
        'a',
        {
          href,
          class:
            current === href || (href !== '#/' && current.startsWith(href))
              ? 'active'
              : '',
        },
        label
      )
    )
  );
  who.replaceChildren(
    state.user
      ? h(
          'span',
          {},
          state.user.name || state.user.email,
          state.user.admin ? ' · admin' : ''
        )
      : h('a', { href: APP_URL }, 'Sign in')
  );
}

// ---- pages -----------------------------------------------------------------

async function browsePage(query = '') {
  const search = h('input', {
    type: 'search',
    placeholder: 'Search plugins',
    value: query,
    'aria-label': 'Search plugins',
  });
  const results = h(
    'div',
    { class: 'grid' },
    h('p', { class: 'muted' }, 'Loading…')
  );
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(search.value.trim()), 250);
  });
  render(
    h('h1', {}, 'Plugins for NotesGraph'),
    h(
      'p',
      { class: 'lead' },
      'Every plugin here was signed by its developer and reviewed before listing. Install one from NotesGraph: Settings → Plugins.'
    ),
    h('div', { class: 'toolbar' }, search),
    results
  );

  async function load(q) {
    try {
      const { plugins } = await api.plugins(q);
      results.replaceChildren(
        ...(plugins.length
          ? plugins.map(p =>
              h(
                'a',
                { class: 'card', href: `#/plugin/${encodeURIComponent(p.id)}` },
                h(
                  'div',
                  { class: 'title' },
                  h('span', {}, p.name),
                  h('span', { class: 'version' }, `v${p.version}`)
                ),
                h('div', { class: 'muted mono' }, p.id),
                h('div', { class: 'desc' }, p.description || 'No description.'),
                h(
                  'div',
                  { class: 'muted' },
                  `by ${p.developer?.name || p.author || 'unknown'}`
                ),
                chips(p.permissions)
              )
            )
          : [
              h(
                'p',
                { class: 'muted' },
                q ? `Nothing matches “${q}”.` : 'No plugins are listed yet.'
              ),
            ])
      );
    } catch (err) {
      results.replaceChildren(errorNote(err));
    }
  }
  await load(query);
}

async function pluginPage(id) {
  render(h('p', { class: 'muted' }, 'Loading…'));
  let data;
  try {
    data = await api.plugin(id);
  } catch (err) {
    return render(h('h1', {}, id), errorNote(err));
  }
  const versions = [...data.versions].sort((a, b) =>
    b.version.localeCompare(a.version, undefined, { numeric: true })
  );
  const latest = versions.find(v => v.status === 'approved') ?? versions[0];
  const installId = h('code', {}, latest.id);
  render(
    h('a', { href: '#/' }, '← All plugins'),
    h(
      'h1',
      {},
      latest.name,
      ' ',
      h('span', { class: 'version' }, `v${latest.version}`)
    ),
    h('p', { class: 'muted mono' }, latest.id),
    h('p', { class: 'lead' }, latest.description || 'No description.'),
    h(
      'div',
      { class: 'panel' },
      h('h2', {}, 'Install'),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, 'Open NotesGraph and go to Settings → Plugins.'),
        h(
          'li',
          {},
          'Find ',
          h('b', {}, latest.name),
          ' in the Marketplace list and press Install.'
        ),
        h(
          'li',
          {},
          'On the phone, the same list is under Settings → Plugins; each device installs its own copy.'
        )
      ),
      h(
        'div',
        { class: 'row' },
        h('span', {}, 'Plugin id: ', installId),
        copyButton(latest.id)
      ),
      h(
        'p',
        { class: 'muted' },
        'Manifest: ',
        h(
          'a',
          {
            href: api.downloadUrl(latest.id, latest.version, 'manifest.json'),
            target: '_blank',
            rel: 'noopener',
          },
          'manifest.json'
        )
      )
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', {}, 'What it can do'),
      latest.permissions?.length
        ? h(
            'dl',
            { class: 'perm-list' },
            latest.permissions.flatMap(p => [
              h(
                'dt',
                {},
                p,
                SENSITIVE.has(p)
                  ? h(
                      'span',
                      { class: 'chip warn', style: 'margin-left:8px' },
                      'sensitive'
                    )
                  : null
              ),
              h(
                'dd',
                {},
                PERMISSIONS[p] ?? 'A permission this site does not know.'
              ),
            ])
          )
        : h('p', { class: 'muted' }, 'It asks for no permissions.'),
      h(
        'dl',
        { class: 'kv' },
        h('dt', {}, 'Platforms'),
        h('dd', {}, (latest.platforms ?? []).join(', ') || 'all'),
        h('dt', {}, 'Server code'),
        h(
          'dd',
          {},
          latest.hasServer ? 'Yes, runs in the marketplace sidecar' : 'No'
        ),
        h('dt', {}, 'Developer'),
        h(
          'dd',
          {},
          latest.developer
            ? `${latest.developer.name} · key ${latest.developer.keyId}`
            : latest.author || 'unknown'
        ),
        h('dt', {}, 'Registry signature'),
        h('dd', { class: 'mono' }, latest.signature)
      )
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', {}, 'Versions'),
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Version'),
            h('th', {}, 'Status'),
            h('th', {}, 'Files')
          )
        ),
        h(
          'tbody',
          {},
          versions.map(v =>
            h(
              'tr',
              {},
              h('td', { class: 'mono' }, v.version),
              h(
                'td',
                {},
                statusBadge(v.status),
                v.rejectedReason
                  ? h('div', { class: 'muted' }, v.rejectedReason)
                  : null
              ),
              h(
                'td',
                {},
                h(
                  'a',
                  {
                    href: api.downloadUrl(v.id, v.version, 'manifest.json'),
                    target: '_blank',
                    rel: 'noopener',
                  },
                  'manifest'
                )
              )
            )
          )
        )
      )
    )
  );
}

async function developerPage() {
  if (!state.user) {
    return render(
      h('h1', {}, 'Developers'),
      signInPrompt(
        'Developer accounts belong to NotesGraph users. Sign in, then come back here.'
      )
    );
  }
  const dev = state.developer;
  const intro = h(
    'div',
    { class: 'panel' },
    h('h2', {}, 'How signing works'),
    h(
      'ol',
      { class: 'steps' },
      h(
        'li',
        {},
        'Your browser generates an Ed25519 key pair. The private key is written to a file you download; it never leaves your machine, and NotesGraph cannot recover it.'
      ),
      h(
        'li',
        {},
        'The public key is registered to your account. The registry names it by its key id.'
      ),
      h(
        'li',
        {},
        'When you publish, this site hashes the manifest and every file and signs the hash with your key. The registry verifies the signature against your registered key before accepting the plugin.'
      )
    )
  );

  if (dev) {
    render(
      h('h1', {}, 'Developer'),
      h(
        'div',
        { class: 'panel' },
        h(
          'dl',
          { class: 'kv' },
          h('dt', {}, 'Name'),
          h('dd', {}, dev.name),
          h('dt', {}, 'Key id'),
          h('dd', { class: 'mono' }, dev.keyId),
          h('dt', {}, 'Registered'),
          h('dd', {}, fmtDate(dev.createdAt)),
          h('dt', {}, 'Public key'),
          h('dd', { class: 'mono' }, dev.publicKey)
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'a',
            { class: 'button primary', href: '#/publish' },
            'Publish a plugin'
          ),
          h('a', { class: 'button', href: '#/mine' }, 'My plugins'),
          h('button', { onclick: () => rotateFlow() }, 'Rotate key')
        ),
        keptKey()
          ? h(
              'p',
              { class: 'muted' },
              'A key is kept on this browser. ',
              h(
                'button',
                {
                  onclick: () => {
                    forgetKey();
                    route();
                  },
                },
                'Forget it'
              )
            )
          : h(
              'p',
              { class: 'muted' },
              'No key is kept on this browser; publishing asks for your key file.'
            )
      ),
      intro
    );
    return;
  }

  render(
    h('h1', {}, 'Become a developer'),
    h(
      'p',
      { class: 'lead' },
      'Publish plugins under your NotesGraph account, signed with a key only you hold.'
    ),
    keyFlow({ rotate: false }),
    intro
  );

  function rotateFlow() {
    render(
      h('h1', {}, 'Rotate your key'),
      h(
        'div',
        { class: 'note warn' },
        'A new key replaces the old one for future publishes. Versions you already published stay valid; you will need the new key file from now on.'
      ),
      keyFlow({ rotate: true, name: dev.name })
    );
  }
}

/** The generate → download → register steps, for a new developer or a rotation. */
function keyFlow({ rotate, name = state.user?.name || '' }) {
  const nameInput = h('input', {
    type: 'text',
    value: name,
    placeholder: 'Shown next to your plugins',
    maxlength: 80,
  });
  const keepBox = h('input', { type: 'checkbox' });
  const status = h('div');
  let keyFile = null;
  const generateBtn = h('button', { class: 'primary' }, 'Generate key');
  const downloadBtn = h('button', { disabled: true }, 'Download key file');
  const registerBtn = h(
    'button',
    { class: 'primary', disabled: true },
    rotate ? 'Register new key' : 'Register'
  );
  let downloaded = false;

  generateBtn.addEventListener('click', async () => {
    status.replaceChildren();
    const displayName = nameInput.value.trim();
    if (!displayName)
      return status.replaceChildren(
        h('div', { class: 'note error' }, 'Enter a display name first.')
      );
    if (!(await ed25519Supported())) {
      return status.replaceChildren(
        h(
          'div',
          { class: 'note error' },
          'This browser cannot make Ed25519 keys. Use Chrome 137+, Safari 17+ or Firefox 130+.'
        )
      );
    }
    keyFile = await generateKeyFile(displayName);
    downloaded = false;
    downloadBtn.disabled = false;
    registerBtn.disabled = true;
    status.replaceChildren(
      h(
        'div',
        { class: 'note' },
        'Key generated. Key id ',
        h('code', {}, keyFile.keyId),
        '. Download the file and keep it safe: NotesGraph never sees the private key and cannot recover it.'
      )
    );
  });
  downloadBtn.addEventListener('click', () => {
    if (!keyFile) return;
    downloadKeyFile(keyFile);
    downloaded = true;
    registerBtn.disabled = false;
    status.replaceChildren(
      h(
        'div',
        { class: 'note' },
        `Saved as ${KEY_FILE_NAME}. Now register the public key.`
      )
    );
  });
  registerBtn.addEventListener('click', async () => {
    if (!keyFile || !downloaded) return;
    registerBtn.disabled = true;
    try {
      await api.registerDeveloper(keyFile.name, keyFile.publicKey);
      if (keepBox.checked) keepKey(keyFile);
      else forgetKey();
      await loadSession();
      location.hash = '#/developer';
      route();
    } catch (err) {
      registerBtn.disabled = false;
      status.replaceChildren(errorNote(err));
    }
  });

  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'field' }, h('label', {}, 'Display name'), nameInput),
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, generateBtn, ' Generated in this browser with WebCrypto.'),
      h('li', {}, downloadBtn, ' The only copy of your private key.'),
      h('li', {}, registerBtn, ' Sends the public key to the registry.')
    ),
    h(
      'label',
      { class: 'row' },
      keepBox,
      ' Keep the key on this browser too (local storage), so publishing does not ask for the file. Off by default.'
    ),
    status
  );
}

async function publishPage() {
  if (!state.user)
    return render(
      h('h1', {}, 'Publish'),
      signInPrompt('Publishing needs a signed-in developer.')
    );
  if (!state.developer) {
    return render(
      h('h1', {}, 'Publish'),
      h(
        'div',
        { class: 'panel' },
        h('p', {}, 'Register as a developer first.'),
        h(
          'a',
          { class: 'button primary', href: '#/developer' },
          'Become a developer'
        )
      )
    );
  }
  const dev = state.developer;
  const out = h('div');
  const summary = h('div');
  const zipInput = h('input', { type: 'file', accept: '.zip,application/zip' });
  const dirInput = h('input', {
    type: 'file',
    webkitdirectory: true,
    multiple: true,
  });
  const drop = h(
    'div',
    { class: 'drop' },
    h('p', {}, 'Drop a .zip of your plugin folder here'),
    h(
      'div',
      { class: 'row', style: 'justify-content:center' },
      h('button', { onclick: () => zipInput.click() }, 'Choose a .zip'),
      h('button', { onclick: () => dirInput.click() }, 'Pick a folder')
    ),
    zipInput,
    dirInput
  );
  drop.addEventListener('dragover', e => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files?.[0];
    if (f) loadZip(f);
  });
  zipInput.addEventListener('change', () => {
    if (zipInput.files[0]) loadZip(zipInput.files[0]);
  });
  dirInput.addEventListener('change', () => {
    if (dirInput.files.length) loadFolder([...dirInput.files]);
  });

  render(
    h('h1', {}, 'Publish a plugin'),
    h(
      'p',
      { class: 'lead' },
      `Signed as ${dev.name} (key ${dev.keyId}). A new version lands as pending until a reviewer approves it.`
    ),
    drop,
    summary,
    out
  );

  async function loadZip(file) {
    out.replaceChildren();
    summary.replaceChildren(
      h('p', { class: 'muted' }, `Reading ${file.name}…`)
    );
    try {
      const entries = await readZip(await file.arrayBuffer());
      prepare(pluginFilesFrom(entries));
    } catch (err) {
      summary.replaceChildren(errorNote(err));
    }
  }

  async function loadFolder(files) {
    out.replaceChildren();
    summary.replaceChildren(h('p', { class: 'muted' }, 'Reading folder…'));
    try {
      const entries = {};
      for (const f of files) {
        const rel = f.webkitRelativePath || f.name;
        if (/(^|\/)(node_modules|\.git|dist)\//.test(rel)) continue;
        entries[rel] = new Uint8Array(await f.arrayBuffer());
      }
      prepare(pluginFilesFrom(entries));
    } catch (err) {
      summary.replaceChildren(errorNote(err));
    }
  }

  function prepare(raw) {
    const problems = [];
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(raw['manifest.json']));
    } catch {
      return summary.replaceChildren(
        h('div', { class: 'note error' }, 'manifest.json is not valid JSON.')
      );
    }
    if (typeof manifest.id !== 'string' || !ID_RE.test(manifest.id))
      problems.push('id must be reverse-DNS, like com.example.todo');
    if (typeof manifest.name !== 'string' || !manifest.name.trim())
      problems.push('name is required');
    if (
      typeof manifest.version !== 'string' ||
      !VERSION_RE.test(manifest.version)
    )
      problems.push('version must be semver, like 1.0.0');
    const clientEntry = manifest.entry?.client ?? 'index.js';
    const files = {};
    for (const [path, bytes] of Object.entries(raw)) {
      if (path === 'manifest.json') continue;
      files[path] = toFileEntry(path, bytes);
    }
    if (!(clientEntry in files))
      problems.push(`entry.client "${clientEntry}" is not in the bundle`);
    if (manifest.entry?.server && !(manifest.entry.server in files))
      problems.push(
        `entry.server "${manifest.entry.server}" is not in the bundle`
      );
    const unknown = (manifest.permissions ?? []).filter(
      p => !(p in PERMISSIONS)
    );
    if (unknown.length)
      problems.push(`unknown permissions: ${unknown.join(', ')}`);
    const totalBytes = Object.values(raw).reduce((n, b) => n + b.length, 0);

    const keyFileInput = h('input', { type: 'file', accept: '.json' });
    const kept = keptKey();
    const keyRow = kept
      ? h('p', {}, `Signing with the key kept on this browser (${kept.keyId}).`)
      : h(
          'div',
          { class: 'field' },
          h('label', {}, `Your ${KEY_FILE_NAME}`),
          keyFileInput
        );
    const submit = h(
      'button',
      { class: 'primary', disabled: problems.length > 0 },
      'Sign and publish'
    );

    summary.replaceChildren(
      h(
        'div',
        { class: 'panel' },
        h(
          'h2',
          {},
          manifest.name || '(unnamed)',
          ' ',
          h('span', { class: 'version' }, `v${manifest.version ?? '?'}`)
        ),
        h('p', { class: 'muted mono' }, manifest.id ?? '(no id)'),
        h('p', {}, manifest.description ?? ''),
        chips(manifest.permissions ?? []),
        h(
          'h3',
          {},
          `Files (${Object.keys(raw).length}, ${fmtBytes(totalBytes)})`
        ),
        h(
          'div',
          { class: 'files' },
          Object.keys(raw)
            .sort()
            .map(p =>
              h(
                'div',
                {},
                h('span', { class: 'mono' }, p),
                h('span', { class: 'muted' }, fmtBytes(raw[p].length))
              )
            )
        ),
        problems.length
          ? h(
              'div',
              { class: 'note error' },
              problems.map(p => `• ${p}`).join('\n')
            )
          : null,
        h('h3', {}, 'Sign'),
        keyRow,
        h('div', { class: 'row' }, submit)
      )
    );

    submit.addEventListener('click', async () => {
      out.replaceChildren(h('p', { class: 'muted' }, 'Signing…'));
      submit.disabled = true;
      try {
        let keyFile = kept;
        if (!keyFile) {
          const f = keyFileInput.files[0];
          if (!f) throw new Error(`Choose your ${KEY_FILE_NAME} to sign with.`);
          keyFile = await parseKeyFile(await f.text());
        }
        if (keyFile.keyId !== dev.keyId) {
          throw new Error(
            `That key (${keyFile.keyId}) is not the one registered to your account (${dev.keyId}). Use the current key file, or rotate your key on the Developer page.`
          );
        }
        const privateKey = await importPrivateKey(keyFile);
        const signature = await signPublish(privateKey, manifest, files);
        out.replaceChildren(h('p', { class: 'muted' }, 'Uploading…'));
        const { plugin } = await api.publish({
          manifest,
          files,
          keyId: keyFile.keyId,
          signature,
        });
        out.replaceChildren(
          h(
            'div',
            { class: 'note' },
            h(
              'b',
              {},
              `${plugin.name} v${plugin.version} is ${plugin.status}.`
            ),
            ' ',
            plugin.status === 'pending'
              ? 'A reviewer will look at the manifest, the permissions and the code; it is listed once approved. Watch its status under My plugins.'
              : 'It is listed in the marketplace now.'
          ),
          h(
            'div',
            { class: 'row' },
            h('a', { class: 'button', href: '#/mine' }, 'My plugins'),
            h(
              'a',
              {
                class: 'button',
                href: `#/plugin/${encodeURIComponent(plugin.id)}`,
              },
              'View'
            )
          )
        );
      } catch (err) {
        submit.disabled = false;
        out.replaceChildren(errorNote(err));
      }
    });
  }
}

async function minePage() {
  if (!state.user)
    return render(
      h('h1', {}, 'My plugins'),
      signInPrompt('Sign in to see what you published.')
    );
  if (!state.developer)
    return render(
      h('h1', {}, 'My plugins'),
      h(
        'div',
        { class: 'panel' },
        h(
          'a',
          { class: 'button primary', href: '#/developer' },
          'Become a developer'
        )
      )
    );
  render(h('h1', {}, 'My plugins'), h('p', { class: 'muted' }, 'Loading…'));
  try {
    const { plugins } = await api.myPlugins();
    render(
      h('h1', {}, 'My plugins'),
      plugins.length
        ? h(
            'div',
            { class: 'panel' },
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', {}, 'Plugin'),
                  h('th', {}, 'Version'),
                  h('th', {}, 'Status'),
                  h('th', {}, 'Published')
                )
              ),
              h(
                'tbody',
                {},
                plugins.map(p =>
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      {},
                      h(
                        'a',
                        { href: `#/plugin/${encodeURIComponent(p.id)}` },
                        p.name
                      ),
                      h('div', { class: 'muted mono' }, p.id)
                    ),
                    h('td', { class: 'mono' }, p.version),
                    h(
                      'td',
                      {},
                      statusBadge(p.status),
                      p.status === 'rejected' && p.rejectedReason
                        ? h('div', { class: 'muted' }, p.rejectedReason)
                        : null
                    ),
                    h('td', {}, fmtDate(p.publishedAt))
                  )
                )
              )
            )
          )
        : h(
            'div',
            { class: 'panel' },
            h('p', {}, 'Nothing published yet.'),
            h(
              'a',
              { class: 'button primary', href: '#/publish' },
              'Publish a plugin'
            )
          )
    );
  } catch (err) {
    render(h('h1', {}, 'My plugins'), errorNote(err));
  }
}

async function reviewPage() {
  if (!state.user?.admin)
    return render(
      h('h1', {}, 'Review'),
      h(
        'div',
        { class: 'panel' },
        h('p', {}, 'Only administrators review submissions.')
      )
    );
  render(h('h1', {}, 'Review'), h('p', { class: 'muted' }, 'Loading…'));
  let plugins;
  try {
    ({ plugins } = await api.pending());
  } catch (err) {
    return render(h('h1', {}, 'Review'), errorNote(err));
  }
  render(
    h('h1', {}, 'Review'),
    h(
      'p',
      { class: 'lead' },
      plugins.length
        ? `${plugins.length} submission${plugins.length === 1 ? '' : 's'} waiting.`
        : 'Nothing is waiting for review.'
    ),
    plugins.map(p => {
      const msg = h('div');
      const approve = h('button', { class: 'primary' }, 'Approve');
      const reject = h('button', { class: 'danger' }, 'Reject');
      const act = async fn => {
        approve.disabled = reject.disabled = true;
        try {
          await fn();
          msg.replaceChildren(h('div', { class: 'note' }, 'Done.'));
          setTimeout(reviewPage, 600);
        } catch (err) {
          approve.disabled = reject.disabled = false;
          msg.replaceChildren(errorNote(err));
        }
      };
      approve.addEventListener('click', () =>
        act(() => api.approve(p.id, p.version))
      );
      reject.addEventListener('click', () => {
        const reason = prompt(
          'Why is it rejected? The developer sees this.',
          ''
        );
        if (reason === null) return;
        act(() => api.reject(p.id, p.version, reason));
      });
      return h(
        'div',
        { class: 'panel' },
        h(
          'h2',
          {},
          p.name,
          ' ',
          h('span', { class: 'version' }, `v${p.version}`)
        ),
        h('p', { class: 'muted mono' }, p.id),
        h('p', {}, p.description ?? ''),
        chips(p.permissions),
        h(
          'dl',
          { class: 'kv' },
          h('dt', {}, 'Developer'),
          h(
            'dd',
            {},
            p.developer
              ? `${p.developer.name} · key ${p.developer.keyId}`
              : 'unknown'
          ),
          h('dt', {}, 'Platforms'),
          h('dd', {}, (p.platforms ?? []).join(', ')),
          h('dt', {}, 'Server code'),
          h('dd', {}, p.hasServer ? 'yes' : 'no'),
          h('dt', {}, 'Files'),
          h(
            'dd',
            {},
            (p.files ?? []).map(f =>
              h(
                'div',
                {},
                h(
                  'a',
                  {
                    class: 'mono',
                    href: api.downloadUrl(p.id, p.version, f),
                    target: '_blank',
                    rel: 'noopener',
                  },
                  f
                )
              )
            )
          )
        ),
        h('div', { class: 'row' }, approve, reject),
        msg
      );
    })
  );
}

// ---- router ----------------------------------------------------------------

function route() {
  renderChrome();
  const hash = location.hash || '#/';
  const [, page, arg] = hash.match(/^#\/([^/]*)\/?(.*)$/) ?? [];
  const show = fn => fn().catch(err => render(errorNote(err)));
  switch (page) {
    case '':
      return show(() => browsePage());
    case 'plugin':
      return show(() => pluginPage(decodeURIComponent(arg)));
    case 'developer':
      return show(developerPage);
    case 'publish':
      return show(publishPage);
    case 'mine':
      return show(minePage);
    case 'review':
      return show(reviewPage);
    default:
      location.hash = '#/';
  }
}

window.addEventListener('hashchange', route);

loadSession().then(route);
api
  .pubkey()
  .then(({ publicKey }) => {
    const el = document.getElementById('registry-key');
    if (el && publicKey)
      el.textContent = `Registry key: ${publicKey.replace(/-----[^-]+-----|\s/g, '').slice(0, 24)}…`;
  })
  .catch(() => {});
