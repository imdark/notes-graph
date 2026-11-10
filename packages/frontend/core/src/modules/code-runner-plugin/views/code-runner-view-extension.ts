import {
  type CodeBlockComponent,
  NotesGraphCodeToolbarWidget,
} from '@blocksuite/notesgraph/blocks/code';
import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { CodeBlockModel } from '@blocksuite/notesgraph/model';
import {
  KeymapExtension,
  LifeCycleWatcher,
  TextSelection,
} from '@blocksuite/notesgraph/std';
import { PlayIcon } from '@blocksuite/icons/lit';
import { html } from 'lit';

import { isRunnableLanguage } from '../runner/format';
import { runCodeBlock } from '../runner/run-code-block';

const RUN_LABEL = 'Run code (Mod-Enter)';

function addRunButton(toolbar: NotesGraphCodeToolbarWidget) {
  toolbar.addPrimaryItems(
    [
      {
        type: 'run-code',
        when: ({ doc, blockComponent }) =>
          !doc.readonly &&
          isRunnableLanguage(
            (blockComponent as CodeBlockComponent).model.props.language
          ),
        generate: ({ blockComponent }) => ({
          action: () => {
            runCodeBlock(blockComponent.model).catch(console.error);
          },
          render: item => html`
            <editor-icon-button
              class="code-toolbar-button run-code"
              aria-label=${RUN_LABEL}
              .tooltip=${RUN_LABEL}
              .tooltipOffset=${4}
              .iconSize=${'16px'}
              .iconContainerPadding=${4}
              @click=${(e: MouseEvent) => {
                e.stopPropagation();
                item.action();
              }}
            >
              ${PlayIcon()}
            </editor-icon-button>
          `,
        }),
      },
    ],
    1
  );
}

/** Adds the Run button to each code block toolbar as it mounts. */
class CodeRunnerToolbarWatcher extends LifeCycleWatcher {
  static override key = 'code-runner-toolbar-watcher';

  override mounted() {
    super.mounted();
    this.std.view.viewUpdated.subscribe(payload => {
      if (payload.type !== 'widget' || payload.method !== 'add') return;
      if (payload.view instanceof NotesGraphCodeToolbarWidget) {
        addRunButton(payload.view);
      }
    });
  }
}

/** Mod-Enter inside a runnable code block runs it, like C-c C-c in org. */
const CodeRunnerKeymap = KeymapExtension(
  std => ({
    'Mod-Enter': ctx => {
      const text = std.selection.find(TextSelection);
      if (!text) return;
      const model = std.store.getBlock(text.from.blockId)?.model;
      if (!(model instanceof CodeBlockModel)) return;
      if (!isRunnableLanguage(model.props.language)) return;
      ctx.get('keyboardState').raw.preventDefault();
      runCodeBlock(model).catch(console.error);
      return true;
    },
  }),
  { flavour: 'notesgraph:code' }
);

export class CodeRunnerViewExtension extends ViewExtensionProvider {
  override name = 'code-runner';

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([CodeRunnerToolbarWatcher, CodeRunnerKeymap]);
  }
}
