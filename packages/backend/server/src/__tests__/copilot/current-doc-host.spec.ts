import test from 'ava';

import {
  CurrentDocHost,
  currentDocPromptParams,
  MAX_CURRENT_DOC_CHARS,
} from '../../plugins/copilot/runtime/hosts/current-doc-host';

/** The open document read into the chat prompt. */

const host = (canRead: boolean, doc: { title: string; markdown: string } | null) =>
  new CurrentDocHost(
    { getDocMarkdown: async () => doc } as any,
    {
      user: () => ({
        workspace: () => ({ doc: () => ({ can: async () => canRead }) }),
      }),
    } as any
  );

test('the open document becomes its title and content', async t => {
  const params = await host(true, {
    title: 'RTX 5090 desktop deal research',
    markdown: '## Bottom line\n\nA prebuilt is the way under $6,000.\n',
  }).promptParams('u1', 'ws', 'doc');
  t.deepEqual(params, {
    currentDocTitle: 'RTX 5090 desktop deal research',
    currentDocContent: '## Bottom line\n\nA prebuilt is the way under $6,000.',
  });
});

test('nothing for a doc the user cannot read, a missing doc, or no doc id', async t => {
  const doc = { title: 'T', markdown: 'x' };
  t.deepEqual(await host(false, doc).promptParams('u1', 'ws', 'doc'), {});
  t.deepEqual(await host(true, null).promptParams('u1', 'ws', 'doc'), {});
  t.deepEqual(await host(true, doc).promptParams('u1', 'ws', undefined), {});
  t.deepEqual(await host(true, doc).promptParams('u1', 'ws', '  '), {});
});

test('a long document is cut, and an untitled one is named', t => {
  const params = currentDocPromptParams({
    title: '',
    markdown: 'a'.repeat(MAX_CURRENT_DOC_CHARS + 10),
  });
  t.is(params.currentDocTitle, 'Untitled');
  t.true(params.currentDocContent.startsWith('a'.repeat(MAX_CURRENT_DOC_CHARS)));
  t.regex(params.currentDocContent, /call doc_read for the rest/);
});
