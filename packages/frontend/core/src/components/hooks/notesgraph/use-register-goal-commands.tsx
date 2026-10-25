import { ListBlockModel } from '@blocksuite/notesgraph/model';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph/shared/commands';
import {
  hasGoalTag,
  matchModels,
  toggleGoalTag,
} from '@blocksuite/notesgraph/shared/utils';
import {
  BlockSelection,
  type BlockStdScope,
  TextSelection,
} from '@blocksuite/notesgraph/std';
import type { BlockModel } from '@blocksuite/notesgraph/store';
import { registerNotesGraphCommand } from '@notesgraph/core/commands';
import type { Editor } from '@notesgraph/core/modules/editor';
import { QuickSearchService } from '@notesgraph/core/modules/quicksearch';
import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

/**
 * The to-dos the palette acts on, captured when it opens: the palette's
 * input steals focus and collapses the caret. A collapsed caret counts as
 * its block.
 */
let paletteTodos: ListBlockModel[] = [];

const targetTodos = (s: BlockStdScope): ListBlockModel[] => {
  const text = s.selection.find(TextSelection);
  let models: BlockModel[];
  if (text?.isCollapsed()) {
    const model = s.store.getBlock(text.from.blockId)?.model;
    models = model ? [model] : [];
  } else if (text || s.selection.value.some(sel => sel.is(BlockSelection))) {
    const [, ctx] = s.command
      .chain()
      .pipe(getSelectedModelsCommand, { types: ['block', 'text'] })
      .run();
    models = ctx.selectedModels ?? [];
  } else {
    models = [];
  }
  return models.filter(
    (model): model is ListBlockModel =>
      matchModels(model, [ListBlockModel]) && model.props.type === 'todo'
  );
};

const isGoal = (model: ListBlockModel) =>
  hasGoalTag(model.props.text.toString());

/**
 * "Mark as goal" / "Unmark as goal" in the Cmd/Ctrl+K palette, for the to-do
 * under the caret or the selected to-dos. A goal is a to-do tagged `#goal`.
 */
export function useRegisterGoalCommands(editor: Editor, active: boolean) {
  const quickSearch = useService(QuickSearchService).quickSearch;

  useEffect(() => {
    if (!active) return;

    const showSubscription = quickSearch.show$.subscribe(show => {
      if (!show) return;
      const s = editor.editorContainer$.value?.host?.std;
      paletteTodos = s ? targetTodos(s) : [];
    });

    const setGoal = (goal: boolean) => {
      const store = editor.editorContainer$.value?.host?.std.store;
      if (!store) return;
      store.transact(() => {
        for (const model of paletteTodos) {
          if (isGoal(model) !== goal) toggleGoalTag(model.props.text);
        }
      });
    };

    const unsubs = [
      () => showSubscription.unsubscribe(),
      registerNotesGraphCommand({
        id: 'editor:selection-mark-goal',
        preconditionStrategy: () => paletteTodos.some(model => !isGoal(model)),
        category: 'editor:selection',
        icon: <span>🎯</span>,
        label: {
          title: 'Mark as goal',
          subTitle: 'Tag this task #goal: a long-term goal, not a to-do',
        },
        run: () => setGoal(true),
      }),
      registerNotesGraphCommand({
        id: 'editor:selection-unmark-goal',
        preconditionStrategy: () =>
          paletteTodos.length > 0 && paletteTodos.every(isGoal),
        category: 'editor:selection',
        icon: <span>🎯</span>,
        label: {
          title: 'Unmark as goal',
          subTitle: 'Remove the #goal tag: back to an ordinary task',
        },
        run: () => setGoal(false),
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [editor, active, quickSearch]);
}
