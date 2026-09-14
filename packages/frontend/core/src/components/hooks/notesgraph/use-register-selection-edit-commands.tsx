import {
  BoldIcon,
  BulletedListIcon,
  CheckBoxCheckLinearIcon,
  CodeIcon,
  DeleteIcon,
  DividerIcon,
  EditIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  Heading6Icon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikeThroughIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextIcon,
  ToggleDownIcon,
  UnderLineIcon,
} from '@blocksuite/icons/rc';
import {
  updateBlockAlign,
  updateBlockType,
} from '@blocksuite/notesgraph/blocks/note';
import {
  textConversionConfigs,
  textAlignConfigs,
} from '@blocksuite/notesgraph/rich-text';
import { textFormatConfigs } from '@blocksuite/notesgraph/inlines/preset';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph/shared/commands';
import {
  ToolbarContext,
  ToolbarModuleIdentifier,
} from '@blocksuite/notesgraph/shared/services';
import {
  BlockSelection,
  type BlockStdScope,
  TextSelection,
} from '@blocksuite/notesgraph/std';
import { registerNotesGraphCommand } from '@notesgraph/core/commands';
import type { Editor } from '@notesgraph/core/modules/editor';
import { QuickSearchService } from '@notesgraph/core/modules/quicksearch';
import { useService } from '@notesgraph/infra';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

// textConversionConfigs/textAlignConfigs carry lit-template icons; the
// command palette needs React nodes, so map by conversion type instead.
const conversionIcons: Record<string, ReactNode> = {
  text: <TextIcon />,
  h1: <Heading1Icon />,
  h2: <Heading2Icon />,
  h3: <Heading3Icon />,
  h4: <Heading4Icon />,
  h5: <Heading5Icon />,
  h6: <Heading6Icon />,
  quote: <QuoteIcon />,
  divider: <DividerIcon />,
  bulleted: <BulletedListIcon />,
  numbered: <NumberedListIcon />,
  todo: <CheckBoxCheckLinearIcon />,
  toggle: <ToggleDownIcon />,
};

const alignIcons: Record<string, ReactNode> = {
  left: <TextAlignLeftIcon />,
  center: <TextAlignCenterIcon />,
  right: <TextAlignRightIcon />,
};

const formatIcons: Record<string, ReactNode> = {
  bold: <BoldIcon />,
  italic: <ItalicIcon />,
  underline: <UnderLineIcon />,
  strike: <StrikeThroughIcon />,
  code: <CodeIcon />,
  link: <LinkIcon />,
};

type SelectionRange = {
  blockId: string;
  index: number;
  length: number;
};

/**
 * Snapshot of the selection the palette should act on, captured when it
 * opens. Module-level on purpose: the command registry ignores duplicate
 * ids, so when hook instances briefly overlap (route transitions, strict
 * mode) the registered command may belong to a different instance than
 * the one whose subscription captured the selection — shared state keeps
 * them consistent.
 */
let paletteSelection: {
  blockIds: string[];
  text: { from: SelectionRange; to: SelectionRange | null } | null;
} = { blockIds: [], text: null };

/**
 * Selection-toolbar actions runnable in the current context, resolved at
 * the moment the palette opens (while the selection is intact — `when`
 * guards read it). Keyed by toolbar action id.
 */
let availableToolbarActions = new Map<
  string,
  { run: (cx: ToolbarContext) => void }
>();

type ToolbarActionLike = {
  id: string;
  label?: string;
  tooltip?: unknown;
  when?: boolean | ((cx: ToolbarContext) => boolean);
  run?: (cx: ToolbarContext) => void;
  generate?: (cx: ToolbarContext) => Partial<ToolbarActionLike> | undefined;
  actions?: ToolbarActionLike[];
};

const TOOLBAR_MODULE_KEYS = [
  'notesgraph:note',
  'custom:notesgraph:note',
  'notesgraph:*',
  'custom:notesgraph:*',
];

/** 'e.copy-as-synced-block' → 'Copy as synced block' (label fallback). */
const humanizeActionId = (id: string): string => {
  const tail = id.split(/[.:]/).pop() ?? id;
  const words = tail.replace(/[-_]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const actionLabel = (
  action: ToolbarActionLike,
  groupLabel?: string
): string => {
  const own =
    action.label ??
    (typeof action.tooltip === 'string' ? action.tooltip : undefined) ??
    humanizeActionId(action.id);
  return groupLabel ? `${groupLabel}: ${own}` : own;
};

/**
 * Flattens the selection-toolbar module tree for this std into leaf
 * actions, ignoring `when` (static — used to register palette commands
 * once). `resolve` applies `generate`/`when` against a live context at
 * palette-open time instead.
 */
const listStaticToolbarActions = (
  s: BlockStdScope
): { id: string; label: string }[] => {
  const result: { id: string; label: string }[] = [];
  const walk = (actions: ToolbarActionLike[], groupLabel?: string) => {
    for (const action of actions) {
      if (Array.isArray(action.actions)) {
        walk(
          action.actions,
          action.label ??
            (typeof action.tooltip === 'string' ? action.tooltip : undefined)
        );
        continue;
      }
      if (typeof action.run !== 'function' && !action.generate) continue;
      result.push({ id: action.id, label: actionLabel(action, groupLabel) });
    }
  };
  for (const key of TOOLBAR_MODULE_KEYS) {
    const module = s.provider.getAll(ToolbarModuleIdentifier).get(key) as
      | { config: { actions: ToolbarActionLike[] } }
      | undefined;
    if (module) walk(module.config.actions);
  }
  return result;
};

/** Live-resolves runnable actions against the intact selection. */
const resolveToolbarActions = (
  s: BlockStdScope
): Map<string, { run: (cx: ToolbarContext) => void }> => {
  const cx = new ToolbarContext(s);
  const resolved = new Map<string, { run: (cx: ToolbarContext) => void }>();
  const passes = (when: ToolbarActionLike['when']) => {
    try {
      return typeof when === 'function' ? when(cx) : (when ?? true);
    } catch {
      return false;
    }
  };
  const walk = (actions: ToolbarActionLike[]) => {
    for (let action of actions) {
      if (action.generate) {
        try {
          action = { ...action, ...action.generate(cx) };
        } catch {
          continue;
        }
      }
      if (!passes(action.when)) continue;
      if (Array.isArray(action.actions)) {
        walk(action.actions);
        continue;
      }
      const run = action.run;
      if (typeof run !== 'function') continue;
      resolved.set(action.id, { run });
    }
  };
  for (const key of TOOLBAR_MODULE_KEYS) {
    const module = s.provider.getAll(ToolbarModuleIdentifier).get(key) as
      | {
          config: {
            actions: ToolbarActionLike[];
            when?: boolean | ((cx: ToolbarContext) => boolean);
          };
        }
      | undefined;
    if (!module || !passes(module.config.when)) continue;
    walk(module.config.actions);
  }
  return resolved;
};

/**
 * Selection-aware entries for the Cmd/Ctrl+K command palette: while text
 * or blocks are selected in the page editor, every action the selection
 * context menu (floating toolbar) offers is also available in the
 * palette, grouped under "Selection" above everything else — inline
 * formatting, turn-into, alignment, copy-as-synced-block, mirrors,
 * delete, and whatever else the toolbar registry contributes.
 *
 * The palette's input steals focus when it opens, which collapses text
 * selections (block selections survive). The selection is therefore
 * snapshotted at the moment the palette opens — while it is still
 * intact — and restored before a command runs. Toolbar `when` guards are
 * evaluated at that same moment, against the live selection.
 */
export function useRegisterSelectionEditCommands(
  editor: Editor,
  active: boolean
) {
  const quickSearch = useService(QuickSearchService).quickSearch;

  useEffect(() => {
    if (!active) return;

    const std = (): BlockStdScope | undefined =>
      editor.editorContainer$.value?.host?.std;

    const selectedBlockIds = (s: BlockStdScope): string[] => {
      const [, ctx] = s.command
        .chain()
        .pipe(getSelectedModelsCommand, { types: ['block', 'text'] })
        .run();
      return ctx.selectedModels?.map(model => model.id) ?? [];
    };

    const hasSelection = () => {
      if (paletteSelection.blockIds.length > 0) return true;
      const s = std();
      if (!s) return false;
      if (s.selection.filter(BlockSelection).length > 0) return true;
      const text = s.selection.find(TextSelection);
      return !!text && !text.isCollapsed();
    };

    const hasTextSelection = () => paletteSelection.text !== null;

    /** Re-establishes the snapshotted selection so commands can act on it. */
    const restoreSelection = () => {
      const s = std();
      if (!s) return;
      if (
        s.selection.filter(BlockSelection).length > 0 ||
        s.selection.find(TextSelection)
      ) {
        return; // still intact
      }
      if (paletteSelection.text) {
        s.selection.setGroup('note', [
          s.selection.create(TextSelection, {
            from: paletteSelection.text.from,
            to: paletteSelection.text.to,
          }),
        ]);
        return;
      }
      if (paletteSelection.blockIds.length > 0) {
        s.selection.setGroup(
          'note',
          paletteSelection.blockIds
            .filter(id => s.store.getBlock(id))
            .map(id => s.selection.create(BlockSelection, { blockId: id }))
        );
      }
    };

    const showSubscription = quickSearch.show$.subscribe(show => {
      if (!show) return;
      // Capture before the palette's focus collapses the selection, and
      // resolve which toolbar actions apply while their `when` guards can
      // still see it.
      const s = std();
      if (!s) {
        paletteSelection = { blockIds: [], text: null };
        availableToolbarActions = new Map();
        return;
      }
      const blockSel = s.selection.filter(BlockSelection).length > 0;
      const textSel = s.selection.find(TextSelection);
      const hasText = !!textSel && !textSel.isCollapsed();
      paletteSelection =
        blockSel || hasText
          ? {
              blockIds: selectedBlockIds(s),
              text:
                hasText && textSel
                  ? { from: textSel.from, to: textSel.to }
                  : null,
            }
          : { blockIds: [], text: null };
      availableToolbarActions =
        blockSel || hasText ? resolveToolbarActions(s) : new Map();
      // Not cleared on hide: a chosen command runs after the palette
      // closes and still needs the snapshot. The next open overwrites it.
    });

    const unsubs: Array<() => void> = [() => showSubscription.unsubscribe()];

    // Inline formatting (bold, italic, underline, strikethrough, code,
    // link) — needs a text selection.
    for (const config of textFormatConfigs) {
      unsubs.push(
        registerNotesGraphCommand({
          id: `editor:selection-format-${config.id}`,
          preconditionStrategy: hasTextSelection,
          category: 'editor:selection',
          icon: formatIcons[config.id] ?? <TextIcon />,
          label: config.name,
          run: () => {
            const s = std();
            if (!s) return;
            restoreSelection();
            s.store.captureSync();
            config.action(s.host);
          },
        })
      );
    }

    // Every runnable action the selection toolbar contributes (registry
    // modules for the page scope) — copy, duplicate, copy-as-synced-block,
    // mirror as table/kanban, highlights, … Availability is resolved
    // per-open against the live selection.
    const registerToolbarCommands = (s: BlockStdScope) => {
      for (const action of listStaticToolbarActions(s)) {
        unsubs.push(
          registerNotesGraphCommand({
            id: `editor:selection-toolbar-${action.id}`,
            preconditionStrategy: () =>
              availableToolbarActions.has(action.id),
            category: 'editor:selection',
            icon: <EditIcon />,
            label: action.label,
            run: () => {
              const current = std();
              const runnable = availableToolbarActions.get(action.id);
              if (!current || !runnable) return;
              restoreSelection();
              runnable.run(new ToolbarContext(current));
            },
          })
        );
      }
    };
    // The editor container may mount after this hook — register the
    // toolbar-derived commands once the std scope exists.
    let toolbarRegistered = false;
    const containerSubscription = editor.editorContainer$.subscribe(() => {
      const s = std();
      if (!s || toolbarRegistered) return;
      toolbarRegistered = true;
      registerToolbarCommands(s);
    });
    unsubs.push(() => containerSubscription.unsubscribe());

    for (const config of textConversionConfigs) {
      // A divider isn't a meaningful mass-conversion target.
      if (config.type === 'divider') continue;
      unsubs.push(
        registerNotesGraphCommand({
          id: `editor:selection-turn-into-${config.type ?? config.flavour}`,
          preconditionStrategy: hasSelection,
          category: 'editor:selection',
          icon: conversionIcons[config.type ?? ''] ?? <TextIcon />,
          label: `Turn selection into ${config.name}`,
          run: () => {
            const s = std();
            if (!s) return;
            restoreSelection();
            s.store.captureSync();
            s.command.exec(updateBlockType, {
              flavour: config.flavour,
              props: { type: config.type },
            });
          },
        })
      );
    }

    for (const config of textAlignConfigs) {
      unsubs.push(
        registerNotesGraphCommand({
          id: `editor:selection-align-${config.textAlign}`,
          preconditionStrategy: hasSelection,
          category: 'editor:selection',
          icon: alignIcons[config.textAlign] ?? <TextAlignLeftIcon />,
          label: `${config.name} (selection)`,
          run: () => {
            const s = std();
            if (!s) return;
            restoreSelection();
            s.store.captureSync();
            s.command.exec(updateBlockAlign, { textAlign: config.textAlign });
          },
        })
      );
    }

    unsubs.push(
      registerNotesGraphCommand({
        id: 'editor:selection-delete-blocks',
        preconditionStrategy: hasSelection,
        category: 'editor:selection',
        icon: <DeleteIcon />,
        label: 'Delete selected blocks',
        run: () => {
          const s = std();
          if (!s) return;
          restoreSelection();
          s.store.captureSync();
          const [, ctx] = s.command
            .chain()
            .pipe(getSelectedModelsCommand, { types: ['block', 'text'] })
            .run();
          ctx.selectedModels?.forEach(model => s.store.deleteBlock(model));
          s.selection.clear();
        },
      })
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [editor, active, quickSearch]);
}
