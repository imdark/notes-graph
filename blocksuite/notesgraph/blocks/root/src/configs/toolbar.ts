import {
  kanbanViewMeta,
  tableViewMeta,
} from '@blocksuite/data-view/view-presets';
import {
  BookmarkIcon,
  CopyIcon,
  DatabaseKanbanViewIcon,
  DatabaseTableViewIcon,
  DeleteIcon,
  DualLinkIcon,
  DuplicateIcon,
  LinkedPageIcon,
  TeXIcon,
} from '@blocksuite/icons/lit';
import {
  MIRROR_ROW_FLAVOUR,
  mirrorListToDatabase,
} from '@blocksuite/notesgraph-block-database';
import {
  convertSelectedBlocksToLinkedDoc,
  getTitleFromSelectedModels,
  notifyDocCreated,
  promptDocTitle,
} from '@blocksuite/notesgraph-block-embed';
import {
  updateBlockAlign,
  updateBlockType,
} from '@blocksuite/notesgraph-block-note';
import type { HighlightType } from '@blocksuite/notesgraph-components/highlight-dropdown-menu';
import { toast } from '@blocksuite/notesgraph-components/toast';
import { EditorChevronDown } from '@blocksuite/notesgraph-components/toolbar';
import { insertInlineLatex } from '@blocksuite/notesgraph-inline-latex';
import {
  deleteTextCommand,
  formatBlockCommand,
  formatNativeCommand,
  formatTextCommand,
  isFormatSupported,
  textFormatConfigs,
} from '@blocksuite/notesgraph-inline-preset';
import {
  EmbedLinkedDocBlockSchema,
  EmbedSyncedDocBlockSchema,
  type TextAlign,
} from '@blocksuite/notesgraph-model';
import {
  textAlignConfigs,
  textConversionConfigs,
} from '@blocksuite/notesgraph-rich-text';
import {
  copySelectedModelsCommand,
  deleteSelectedModelsCommand,
  draftSelectedModelsCommand,
  duplicateSelectedModelsCommand,
  getBlockSelectionsCommand,
  getImageSelectionsCommand,
  getSelectedBlocksCommand,
  getSelectedModelsCommand,
  getTextSelectionCommand,
} from '@blocksuite/notesgraph-shared/commands';
import type {
  ToolbarAction,
  ToolbarActionGenerator,
  ToolbarActionGroup,
  ToolbarModuleConfig,
} from '@blocksuite/notesgraph-shared/services';
import {
  ActionPlacement,
  blockCommentToolbarButton,
  EmbedOptionProvider,
} from '@blocksuite/notesgraph-shared/services';
import {
  getMostCommonValue,
  isValidUrl,
  SYNCED_BLOCK_CLIPBOARD_TYPE,
  syncedBlockToHtml,
} from '@blocksuite/notesgraph-shared/utils';
import {
  type BlockComponent,
  BlockSelection,
  BlockViewIdentifier,
  TextSelection,
} from '@blocksuite/std';
import { toDraftModel } from '@blocksuite/store';
import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

/**
 * When the selected text is itself an http(s) URL, lead the toolbar with a
 * one-tap "Turn into card" — the most likely intent for a selected raw link.
 */
function selectedUrlContext(host: BlockComponent['host']) {
  const std = host.std;
  const sel = std.selection.find(TextSelection);
  // single-block, non-collapsed selection only
  if (!sel || sel.to || sel.from.length === 0) return null;
  const block = std.store.getBlock(sel.from.blockId);
  const model = block?.model;
  const text = model?.text;
  if (!model || !text) return null;
  const raw = text
    .toString()
    .slice(sel.from.index, sel.from.index + sel.from.length)
    .trim();
  if (!/^https?:\/\/\S+$/i.test(raw) || !isValidUrl(raw)) return null;
  return { std, sel, model, url: raw };
}

const urlToCardAction = {
  id: 'a.a-url-to-card',
  when: ({ host }) => !!selectedUrlContext(host),
  icon: BookmarkIcon(),
  label: 'Turn into card',
  tooltip: 'Turn the selected link into a card',
  run: ({ host }) => {
    const ctx = selectedUrlContext(host);
    if (!ctx) return;
    const { std, sel, model, url } = ctx;
    const parent = std.store.getParent(model);
    if (!parent) return;

    std.store.captureSync();
    const flavour =
      std.get(EmbedOptionProvider).getEmbedBlockOptions(url)?.flavour ??
      'notesgraph:bookmark';
    const index = parent.children.indexOf(model);
    const blockId = std.store.addBlock(
      flavour as never,
      { url },
      parent,
      index + 1
    );

    // remove the selected url text; drop the paragraph if that was all of it
    model.text?.delete(sel.from.index, sel.from.length);
    if ((model.text?.length ?? 0) === 0) {
      std.store.deleteBlock(model);
    }
    std.selection.setGroup('note', [
      std.selection.create(BlockSelection, { blockId }),
    ]);
  },
} as const satisfies ToolbarAction;

const conversionsActionGroup = {
  id: 'a.conversions',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  generate({ chain }) {
    const [ok, { selectedModels = [] }] = chain
      .tryAll(chain => [
        chain.pipe(getTextSelectionCommand),
        chain.pipe(getBlockSelectionsCommand),
      ])
      .pipe(getSelectedModelsCommand, { types: ['text', 'block'] })
      .run();

    // only support model with text
    // TODO(@fundon): displays only in a single paragraph, `length === 1`.
    const allowed = ok && selectedModels.filter(model => model.text).length > 0;
    if (!allowed) return null;

    const model = selectedModels[0];
    const conversion =
      textConversionConfigs.find(
        ({ flavour, type }) =>
          flavour === model.flavour &&
          (type ? 'type' in model.props && type === model.props.type : true)
      ) ?? textConversionConfigs[0];
    const update = (flavour: string, type?: string) => {
      chain
        .pipe(updateBlockType, {
          flavour,
          ...(type && { props: { type } }),
        })
        .run();
    };

    return {
      content: html`
        <editor-menu-button
          .contentPadding="${'8px'}"
          .button=${html`
            <editor-icon-button
              aria-label="Conversions"
              .tooltip="${'Turn into'}"
            >
              ${conversion.icon} ${EditorChevronDown}
            </editor-icon-button>
          `}
        >
          <div data-size="large" data-orientation="vertical">
            ${repeat(
              textConversionConfigs.filter(
                c => c.flavour !== 'notesgraph:divider'
              ),
              item => item.name,
              ({ flavour, type, name, icon }) => html`
                <editor-menu-action
                  aria-label=${name}
                  ?data-selected=${conversion.name === name}
                  @click=${() => update(flavour, type)}
                >
                  ${icon}<span class="label">${name}</span>
                </editor-menu-action>
              `
            )}
          </div>
        </editor-menu-button>
      `,
    };
  },
} as const satisfies ToolbarActionGenerator;

const alignActionGroup = {
  id: 'b.align',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  generate({ chain }) {
    const [ok, { selectedModels = [] }] = chain
      .tryAll(chain => [
        chain.pipe(getTextSelectionCommand),
        chain.pipe(getBlockSelectionsCommand),
      ])
      .pipe(getSelectedModelsCommand, { types: ['text', 'block'] })
      .run();
    if (!ok) return null;

    const alignment =
      textAlignConfigs.find(
        ({ textAlign }) =>
          textAlign ===
          getMostCommonValue(
            selectedModels.map(
              ({ props }) => props as { textAlign?: TextAlign }
            ),
            'textAlign'
          )
      ) ?? textAlignConfigs[0];
    const update = (textAlign: TextAlign) => {
      chain.pipe(updateBlockAlign, { textAlign }).run();
    };

    return {
      content: html`
        <editor-menu-button
          .contentPadding="${'8px'}"
          .button=${html`
            <editor-icon-button aria-label="Align" .tooltip="${'Align'}">
              ${alignment.icon} ${EditorChevronDown}
            </editor-icon-button>
          `}
        >
          <div data-size="large" data-orientation="vertical">
            ${repeat(
              textAlignConfigs,
              item => item.name,
              ({ textAlign, name, icon }) => html`
                <editor-menu-action
                  aria-label=${name}
                  @click=${() => update(textAlign)}
                >
                  ${icon}<span class="label">${name}</span>
                </editor-menu-action>
              `
            )}
          </div>
        </editor-menu-button>
      `,
    };
  },
} as const satisfies ToolbarActionGenerator;

const inlineTextActionGroup = {
  id: 'b.inline-text',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  actions: textFormatConfigs.flatMap(
    ({ id, name, action, activeWhen, icon }, score) => {
      const textAction: ToolbarAction = {
        id,
        icon,
        score,
        tooltip: name,
        run: ({ host }) => action(host),
        active: ({ host }) => activeWhen(host),
      };

      if (id !== 'underline') {
        return [textAction];
      }

      return [
        textAction,
        {
          id: 'inline-latex',
          icon: TeXIcon(),
          score: score + 0.5,
          tooltip: 'Inline Equation',
          run: ({ host }) => {
            host.std.command
              .chain()
              .pipe(getTextSelectionCommand)
              .pipe(insertInlineLatex)
              .run();
          },
          active: () => false,
        },
      ];
    }
  ),
} as const satisfies ToolbarActionGroup;

const highlightActionGroup = {
  id: 'c.highlight',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  content({ chain }) {
    const updateHighlight = (styles: HighlightType) => {
      const payload = { styles };
      chain
        .try(chain => [
          chain.pipe(getTextSelectionCommand).pipe(formatTextCommand, payload),
          chain
            .pipe(getBlockSelectionsCommand)
            .pipe(formatBlockCommand, payload),
          chain.pipe(formatNativeCommand, payload),
        ])
        .run();
    };
    return html`
      <notesgraph-highlight-dropdown-menu
        .updateHighlight=${updateHighlight}
      ></notesgraph-highlight-dropdown-menu>
    `;
  },
} as const satisfies ToolbarAction;

// Shared gate for the mirror actions: every selected block must be a list
// item, since a mirror database tracks a contiguous run of list blocks.
const mirrorWhen: ToolbarAction['when'] = ({ chain }) => {
  const middleware = (count = 0) => {
    return (ctx: { selectedBlocks: BlockComponent[] }, next: () => void) => {
      const { selectedBlocks } = ctx;
      if (!selectedBlocks || selectedBlocks.length === count) return;

      const allowed = selectedBlocks.every(
        block => block.flavour === MIRROR_ROW_FLAVOUR
      );
      if (!allowed) return;

      next();
    };
  };

  let [ok] = chain
    .pipe(getTextSelectionCommand)
    .pipe(getSelectedBlocksCommand, {
      types: ['text'],
    })
    .pipe(middleware(1))
    .run();

  if (ok) return true;

  [ok] = chain
    .pipe(getBlockSelectionsCommand)
    .pipe(getSelectedBlocksCommand, {
      types: ['block'],
    })
    .pipe(middleware(0))
    .run();

  return ok;
};

/**
 * Notion-style synced block, step 1 of 2: copies a live reference to the
 * current block. Pasting it (in any doc) creates an embed bound to this
 * block's own text — edits flow both ways. The payload rides inside the
 * blocksuite clipboard snapshot; plain text falls back to the block's
 * content for external apps.
 */
const copyAsSyncedBlock = {
  id: 'e.copy-as-synced-block',
  tooltip: 'Copy as synced block',
  icon: DualLinkIcon(),
  when({ std }) {
    const sel = std.selection.find(TextSelection);
    const blockId =
      sel?.blockId ?? std.selection.find(BlockSelection)?.blockId;
    if (!blockId) return false;
    const model = std.store.getBlock(blockId)?.model;
    return (
      !!model?.text &&
      (model.flavour === 'notesgraph:paragraph' ||
        model.flavour === 'notesgraph:list')
    );
  },
  run({ host }) {
    const std = host.std;
    const sel = std.selection.find(TextSelection);
    const blockId =
      sel?.blockId ?? std.selection.find(BlockSelection)?.blockId;
    if (!blockId) return;
    const model = std.store.getBlock(blockId)?.model;
    if (!model?.text) return;

    const payload = { pageId: host.store.id, blockId: model.id };
    const text = model.text?.toString() ?? '';

    // Synchronous execCommand copy with a one-shot listener: the async
    // clipboard API needs focus/permissions that aren't reliably present.
    // The payload rides in text/html (custom MIME types get dropped by the
    // OS clipboard; text/html survives) — plain text stays the cross-app
    // fallback, the custom MIME a same-page fast path.
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      // keep the editor's own copy handler from overwriting our payload
      // with a block-snapshot clipboard
      e.stopImmediatePropagation();
      e.clipboardData?.setData('text/plain', text);
      e.clipboardData?.setData('text/html', syncedBlockToHtml(payload, text));
      e.clipboardData?.setData(
        SYNCED_BLOCK_CLIPBOARD_TYPE,
        JSON.stringify(payload)
      );
    };
    document.addEventListener('copy', onCopy, { once: true, capture: true });
    try {
      document.execCommand('copy');
      toast(host, 'Copied — paste anywhere to create a synced block');
    } finally {
      document.removeEventListener('copy', onCopy, { capture: true });
    }
  },
} as const satisfies ToolbarAction;

const mirrorIntoTable = {
  id: 'e.mirror-as-table',
  tooltip: 'Mirror as Table',
  icon: DatabaseTableViewIcon(),
  when: mirrorWhen,
  run({ host }) {
    mirrorListToDatabase(host, tableViewMeta.type);
  },
} as const satisfies ToolbarAction;

const mirrorIntoKanban = {
  id: 'e.mirror-as-kanban',
  tooltip: 'Mirror as Kanban',
  icon: DatabaseKanbanViewIcon(),
  when: mirrorWhen,
  run({ host }) {
    mirrorListToDatabase(host, kanbanViewMeta.type);
  },
} as const satisfies ToolbarAction;

const turnIntoLinkedDoc = {
  id: 'f.convert-to-linked-doc',
  tooltip: 'Create Linked Doc',
  icon: LinkedPageIcon(),
  when({ chain, std }) {
    const supportFlavours = [
      EmbedLinkedDocBlockSchema,
      EmbedSyncedDocBlockSchema,
    ].map(schema => schema.model.flavour);
    if (
      supportFlavours.some(
        flavour => !std.getOptional(BlockViewIdentifier(flavour))
      )
    )
      return false;

    const [ok, { selectedModels }] = chain
      .pipe(getSelectedModelsCommand, {
        types: ['block', 'text'],
        mode: 'flat',
      })
      .run();
    return ok && Boolean(selectedModels?.length);
  },
  run({ chain, store, selection, std, track }) {
    const [ok, { draftedModels, selectedModels }] = chain
      .pipe(getSelectedModelsCommand, {
        types: ['block', 'text'],
        mode: 'flat',
      })
      .pipe(draftSelectedModelsCommand)
      .run();
    if (!ok || !draftedModels || !selectedModels?.length) return;

    selection.clear();

    const autofill = getTitleFromSelectedModels(
      selectedModels.map(toDraftModel)
    );
    promptDocTitle(std, autofill)
      .then(async title => {
        if (title === null) return;
        await convertSelectedBlocksToLinkedDoc(
          std,
          store,
          draftedModels,
          title
        );
        notifyDocCreated(std);

        track('DocCreated', {
          segment: 'doc',
          page: 'doc editor',
          module: 'toolbar',
          control: 'create linked doc',
          type: 'embed-linked-doc',
        });

        track('LinkedDocCreated', {
          segment: 'doc',
          page: 'doc editor',
          module: 'toolbar',
          control: 'create linked doc',
          type: 'embed-linked-doc',
        });
      })
      .catch(console.error);
  },
} as const satisfies ToolbarAction;

export const builtinToolbarConfig = {
  actions: [
    urlToCardAction,
    conversionsActionGroup,
    alignActionGroup,
    inlineTextActionGroup,
    highlightActionGroup,
    mirrorIntoTable,
    mirrorIntoKanban,
    copyAsSyncedBlock,
    turnIntoLinkedDoc,
    {
      id: 'g.comment',
      ...blockCommentToolbarButton,
    },
    {
      placement: ActionPlacement.More,
      id: 'a.clipboard',
      actions: [
        {
          id: 'copy',
          label: 'Copy',
          icon: CopyIcon(),
          run({ chain, host }) {
            const [ok] = chain
              .pipe(getSelectedModelsCommand)
              .pipe(draftSelectedModelsCommand)
              .pipe(copySelectedModelsCommand)
              .run();

            if (!ok) return;

            toast(host, 'Copied to clipboard');
          },
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: DuplicateIcon(),
          run({ chain, store, selection }) {
            store.captureSync();

            const [ok, { selectedBlocks = [] }] = chain
              .pipe(getTextSelectionCommand)
              .pipe(getSelectedBlocksCommand, {
                types: ['text'],
                mode: 'highest',
              })
              .run();

            // If text selection exists, convert to block selection
            if (ok && selectedBlocks.length) {
              selection.setGroup(
                'note',
                selectedBlocks.map(block =>
                  selection.create(BlockSelection, {
                    blockId: block.model.id,
                  })
                )
              );
            }

            chain
              .pipe(getSelectedModelsCommand, {
                types: ['block', 'image'],
                mode: 'highest',
              })
              .pipe(duplicateSelectedModelsCommand)
              .run();
          },
        },
      ],
      when(ctx) {
        return !ctx.flags.isNative();
      },
    },
    {
      placement: ActionPlacement.More,
      id: 'c.delete',
      actions: [
        {
          id: 'delete',
          label: 'Delete',
          icon: DeleteIcon(),
          variant: 'destructive',
          run({ chain }) {
            // removes text
            const [ok] = chain
              .pipe(getTextSelectionCommand)
              .pipe(deleteTextCommand)
              .run();

            if (ok) return;

            // removes blocks
            chain
              .tryAll(chain => [
                chain.pipe(getBlockSelectionsCommand),
                chain.pipe(getImageSelectionsCommand),
              ])
              .pipe(getSelectedModelsCommand)
              .pipe(deleteSelectedModelsCommand)
              .run();
          },
        },
      ],
      when(ctx) {
        return !ctx.flags.isNative();
      },
    },
  ],
} as const satisfies ToolbarModuleConfig;
