const newE2E = process.env.TEST_MODE === 'e2e';
const newE2ETests = './src/__tests__/e2e/**/*.spec.ts';

/**
 * Absolute file: URLs, not './src/...'.
 *
 * ava hands each `require` entry to a generated shim that lives in
 * node_modules/.cache/ava and does nothing but `import(ref)`, so a relative
 * ref resolves against the *cache* directory and every test run dies with
 * "Cannot find module .../node_modules/.cache/ava/src/prelude.ts".
 */
const prelude = name => new URL(name, import.meta.url).href;

const preludes = [prelude('./src/prelude.ts')];

if (newE2E) {
  preludes.push(prelude('./src/__tests__/e2e/prelude.ts'));
}

/**
 * The same TypeScript loader `r` uses for server files (tools/cli/register.js
 * -> hooks.js). Without it ava runs the specs as plain ESM, and the first
 * extensionless import in the prelude fails with ERR_MODULE_NOT_FOUND.
 */
const tsLoader = new URL('../../../tools/cli/register.js', import.meta.url).href;

export default {
  nodeArguments: [`--import=${tsLoader}`],
  timeout: '1m',
  extensions: {
    ts: 'module',
  },
  watchMode: {
    ignoreChanges: ['**/*.gen.*'],
  },
  files: newE2E
    ? [newE2ETests]
    : ['**/*.spec.ts', '**/*.e2e.ts', '!' + newE2ETests],
  require: preludes,
  environmentVariables: {
    NODE_ENV: 'test',
    DEPLOYMENT_TYPE: 'notesgraph',
    MAILER_HOST: '0.0.0.0',
    MAILER_PORT: '1025',
    MAILER_USER: 'noreply@notesgraph.com',
    MAILER_PASSWORD: 'notesgraph',
    MAILER_SENDER: 'noreply@notesgraph.com',
  },
};
