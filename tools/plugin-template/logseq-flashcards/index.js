/**
 * Logseq Flashcards: turn the open note into Logseq `#card` blocks.
 *
 * Logseq treats a block tagged `#card` as a flashcard: the block is the front,
 * its child blocks are the back. This plugin finds the question/answer pairs
 * in a note and writes them in that shape, either to the clipboard (paste into
 * any Logseq page and the blocks keep their nesting) or as a `.md` page file
 * for a graph's `pages/` folder.
 *
 * What counts as a card, in note order:
 *   - a block whose text ends in "?" or carries #card: the question, with
 *     everything nested under it as the answer;
 *   - any other heading, list item or paragraph with content under it (nested
 *     blocks, or the paragraphs after a heading up to the next heading),
 *     unless that content holds cards of its own, in which case it is a topic
 *     and its cards are used instead.
 * So the cards `create_flashcards` makes (a collapsed list item with the
 * answer inside) come out one to one.
 *
 * Plain ESM with no build step, like the other bundled plugins; React comes
 * from the host through the import map, hence `createElement` and no JSX.
 */
import { createElement as h, useCallback, useEffect, useState } from 'react';

const NOTE = 'notesgraph:note';
const PARAGRAPH = 'notesgraph:paragraph';
const LIST = 'notesgraph:list';
const CODE = 'notesgraph:code';
const BOOKMARK = 'notesgraph:bookmark';
const HEADING = /^h[1-6]$/;
const CARD_TAG = /(^|\s)(#card|#\[\[card\]\]|\[\[card\]\])(?=\s|$)/gi;

const message = err => (err instanceof Error ? err.message : String(err));

// --- Notes -> cards ---------------------------------------------------------

const isHeading = block =>
  block.flavour === PARAGRAPH && HEADING.test(String(block.props.type ?? ''));

const textOf = block => String(block.props.text ?? '').trim();

const hasCardTag = text => new RegExp(CARD_TAG.source, 'i').test(text);

const isQuestion = text => text.endsWith('?') || hasCardTag(text);

/** One block's own line as Logseq text, or '' when it has nothing to show. */
function lineOf(block) {
  const text = textOf(block);
  switch (block.flavour) {
    case PARAGRAPH:
      if (!text) return '';
      return block.props.type === 'quote' ? `> ${text}` : text;
    case LIST:
      if (!text) return '';
      if (block.props.type === 'todo') {
        return `${block.props.checked ? 'DONE' : 'TODO'} ${text}`;
      }
      return text;
    case CODE: {
      const code = String(block.props.text ?? '').replace(/\s+$/, '');
      if (!code) return '';
      const lang = String(block.props.language ?? '').trim();
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case BOOKMARK:
      return String(block.props.url ?? '').trim();
    default:
      return '';
  }
}

/**
 * Builds the answer tree for a run of blocks. A block with no line of its own
 * (an image, a divider) passes its children up rather than losing them.
 */
function outline(blocks, byId) {
  const nodes = [];
  for (const block of blocks) {
    const children = outline(kids(block, byId), byId);
    const text = lineOf(block);
    if (text) nodes.push({ text, children });
    else nodes.push(...children);
  }
  return nodes;
}

const kids = (block, byId) =>
  block.children.map(id => byId.get(id)).filter(Boolean);

function cardFrom(block, body, byId) {
  const answer = outline(body, byId);
  if (answer.length === 0) return null;
  return { question: textOf(block), answer };
}

/** The cards in a run of sibling blocks, in order. */
function cardsIn(blocks, byId) {
  const cards = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    let body = kids(block, byId);
    if (isHeading(block)) {
      // A heading's body is what follows it, up to the next heading.
      let j = i + 1;
      while (j < blocks.length && !isHeading(blocks[j])) j++;
      body = [...body, ...blocks.slice(i + 1, j)];
      i = j - 1;
    }

    const text = textOf(block);
    const asksSomething =
      (block.flavour === PARAGRAPH || block.flavour === LIST) && text;
    if (asksSomething && isQuestion(text)) {
      const card = cardFrom(block, body, byId);
      if (card) cards.push(card);
      continue;
    }
    const inner = cardsIn(body, byId);
    if (inner.length > 0) {
      cards.push(...inner);
    } else if (asksSomething) {
      const card = cardFrom(block, body, byId);
      if (card) cards.push(card);
    }
  }
  return cards;
}

/** The flashcards in a note, from `ctx.docs.getBlocks` output. */
export function extractCards(blocks) {
  const byId = new Map(blocks.map(b => [b.id, b]));
  // Notes hang off the page block in display order; follow that rather than
  // the store's map order.
  const page = blocks.find(b => b.flavour === 'notesgraph:page');
  const ordered = page
    ? kids(page, byId).filter(b => b.flavour === NOTE)
    : blocks.filter(b => b.flavour === NOTE);
  return ordered.flatMap(note => cardsIn(kids(note, byId), byId));
}

// --- Cards -> Logseq markdown ------------------------------------------------

function pushBlock(lines, depth, text) {
  const indent = '\t'.repeat(depth);
  const [first, ...rest] = text.split('\n');
  lines.push(`${indent}- ${first}`);
  // Continuation lines of a multi-line block line up under its text.
  for (const line of rest) lines.push(`${indent}  ${line}`);
}

function pushTree(lines, depth, nodes) {
  for (const node of nodes) {
    pushBlock(lines, depth, node.text);
    pushTree(lines, depth + 1, node.children);
  }
}

function frontOf(question) {
  const plain = question.replace(CARD_TAG, '$1').replace(/\s+/g, ' ').trim();
  return `${plain} #card`;
}

/** A Logseq page body: one `#card` block per card, its answer nested under it. */
export function toLogseq(cards) {
  const lines = [];
  for (const card of cards) {
    pushBlock(lines, 0, frontOf(card.question));
    pushTree(lines, 1, card.answer);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** A Logseq-safe page file name for a note title. */
export function fileNameFor(title) {
  const base =
    String(title ?? '')
      .replace(/[\\/:*?"<>|#]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled';
  return `${base}.md`;
}

// --- Delivery ---------------------------------------------------------------

async function copyText(text) {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) {
    throw new Error('This browser does not allow copying from a plugin.');
  }
  await clipboard.writeText(text);
}

function downloadText(fileName, text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/markdown;charset=utf-8' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const plural = n => (n === 1 ? '1 card' : `${n} cards`);

const nameOf = doc => String(doc.title ?? '').trim() || 'Untitled';

const NO_CARDS_HINT =
  'Write a question ending in "?" with its answer nested under it, or put the answer under a heading.';

// --- UI ---------------------------------------------------------------------

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12 },
  title: { fontSize: 13, fontWeight: 600 },
  desc: { fontSize: 12, opacity: 0.75, lineHeight: 1.5 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  button: {
    fontSize: 12,
    // A full tap target: the plugin also runs on phones.
    minHeight: 44,
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  preview: {
    margin: 0,
    padding: 10,
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    tabSize: 2,
    maxHeight: 420,
    overflow: 'auto',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.25)',
  },
  // The host's error colour is tuned per theme; the fallback is for tests.
  error: {
    fontSize: 12,
    color: 'var(--notesgraph-error-color, #d92d20)',
    lineHeight: 1.5,
  },
};

export default {
  activate(ctx) {
    const { ui, docs, hooks } = ctx;

    /** The open note and its cards, or null when no note is open. */
    const current = async () => {
      const doc = await docs.getCurrent();
      if (!doc) return null;
      const cards = extractCards(await docs.getBlocks(doc.id));
      return { doc, cards, markdown: toLogseq(cards) };
    };

    /** Runs `deliver` on the open note's cards, telling the user how it went. */
    const exportCurrent = async (deliver, done) => {
      try {
        const result = await current();
        if (!result) {
          ui.notify({
            title: 'Open a note first',
            message: 'Flashcards are made from the note you have open.',
            theme: 'warning',
          });
          return;
        }
        if (result.cards.length === 0) {
          ui.notify({
            title: `No flashcards in "${nameOf(result.doc)}"`,
            message: NO_CARDS_HINT,
            theme: 'warning',
          });
          return;
        }
        await deliver(result);
        ui.notify({ ...done(result), theme: 'success' });
      } catch (err) {
        ui.notify({
          title: 'Could not export flashcards',
          message: message(err),
          theme: 'error',
        });
      }
    };

    const copy = () =>
      exportCurrent(
        r => copyText(r.markdown),
        r => ({
          title: `Copied ${plural(r.cards.length)}`,
          message: 'Paste them into a Logseq page.',
        })
      );

    const download = () =>
      exportCurrent(
        r => downloadText(fileNameFor(r.doc.title), r.markdown),
        r => ({
          title: `Saved ${fileNameFor(r.doc.title)}`,
          message: `${plural(r.cards.length)}. Put the file in your graph's pages folder.`,
        })
      );

    // The host disposes contributions on deactivate; no need to track them.
    ui.addCommand({
      id: 'logseq-flashcards:copy',
      label: "Logseq flashcards: Copy this note's cards",
      run: copy,
    });
    ui.addCommand({
      id: 'logseq-flashcards:download',
      label: 'Logseq flashcards: Download this note as a Logseq page',
      run: download,
    });

    function FlashcardsPanel() {
      const [state, setState] = useState({ status: 'loading' });

      const load = useCallback(async () => {
        setState(s => (s.status === 'ready' ? s : { status: 'loading' }));
        try {
          const result = await current();
          setState(
            result ? { status: 'ready', ...result } : { status: 'none' }
          );
        } catch (err) {
          setState({ status: 'error', error: message(err) });
        }
      }, []);

      useEffect(() => {
        load().catch(() => {});
        return hooks.on('doc.open', () => {
          load().catch(() => {});
        });
      }, [load]);

      const refresh = h(
        'button',
        { type: 'button', style: styles.button, onClick: load },
        'Refresh'
      );

      if (state.status === 'loading') {
        return h(
          'div',
          { style: styles.page },
          h('div', { style: styles.desc }, 'Reading the note…')
        );
      }
      if (state.status === 'error') {
        return h(
          'div',
          { style: styles.page },
          h(
            'div',
            { style: styles.error, role: 'alert' },
            `Could not read the note: ${state.error}`
          ),
          h('div', { style: styles.actions }, refresh)
        );
      }
      if (state.status === 'none') {
        return h(
          'div',
          { style: styles.page },
          h(
            'div',
            { style: styles.desc },
            'Open a note to make Logseq flashcards from it.'
          )
        );
      }

      const { doc, cards, markdown } = state;
      const name = nameOf(doc);
      if (cards.length === 0) {
        return h(
          'div',
          { style: styles.page },
          h('div', { style: styles.title }, `No flashcards in "${name}"`),
          h('div', { style: styles.desc }, NO_CARDS_HINT),
          h('div', { style: styles.actions }, refresh)
        );
      }

      return h(
        'div',
        { style: styles.page },
        h(
          'div',
          { style: styles.title },
          `${plural(cards.length)} from "${name}"`
        ),
        h(
          'div',
          { style: styles.actions },
          h(
            'button',
            { type: 'button', style: styles.button, onClick: copy },
            'Copy for Logseq'
          ),
          h(
            'button',
            { type: 'button', style: styles.button, onClick: download },
            'Download .md'
          ),
          refresh
        ),
        h(
          'pre',
          { style: styles.preview, 'aria-label': 'Logseq markdown' },
          markdown
        )
      );
    }

    ui.addSidebarPanel({
      id: 'logseq-flashcards',
      title: 'Logseq flashcards',
      component: FlashcardsPanel,
    });
  },
};
