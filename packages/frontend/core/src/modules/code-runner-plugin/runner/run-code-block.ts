import type { CodeBlockModel } from '@blocksuite/notesgraph/model';
import { Text } from '@blocksuite/notesgraph/store';

import { formatOutcome, isRunnableLanguage, RESULTS_CAPTION } from './format';
import { runJavaScript } from './run-javascript';

/** The Results block of a source block: the code block right after it. */
export function findResultsBlock(model: CodeBlockModel) {
  const next = model.store.getNext(model);
  if (
    next?.flavour === 'notesgraph:code' &&
    (next as CodeBlockModel).props.caption === RESULTS_CAPTION
  ) {
    return next as CodeBlockModel;
  }
  return null;
}

/** Write the output into the Results block, creating it the first time. */
export function writeResults(model: CodeBlockModel, output: string) {
  const store = model.store;
  const existing = findResultsBlock(model);
  if (existing) {
    store.transact(() => {
      existing.props.text.replace(0, existing.props.text.length, output);
    });
    return existing.id;
  }
  const parent = store.getParent(model);
  if (!parent) return null;
  return store.addBlock(
    'notesgraph:code',
    {
      text: new Text(output),
      language: null,
      caption: RESULTS_CAPTION,
    },
    parent,
    parent.children.indexOf(model) + 1
  );
}

const running = new WeakSet<CodeBlockModel>();

/**
 * Run a code block and record what it printed and returned below it. Re-running
 * replaces the previous results, as org-mode Babel does.
 */
export async function runCodeBlock(model: CodeBlockModel) {
  if (model.store.readonly) return;
  if (!isRunnableLanguage(model.props.language)) return;
  if (running.has(model)) return;
  running.add(model);
  try {
    const outcome = await runJavaScript(model.props.text.toString());
    writeResults(model, formatOutcome(outcome));
  } finally {
    running.delete(model);
  }
}
