import { DisposableGroup } from '@blocksuite/global/disposable';
import {
  copyMiddleware,
  defaultImageProxyMiddleware,
  titleMiddleware,
} from '@blocksuite/notesgraph-shared/adapters';
import {
  copySelectedModelsCommand,
  draftSelectedModelsCommand,
  getSelectedModelsCommand,
} from '@blocksuite/notesgraph-shared/commands';
import {
  LifeCycleWatcher,
  TextSelection,
  type UIEventHandler,
} from '@blocksuite/std';

/**
 * ReadOnlyClipboard is a class that provides a read-only clipboard for the root block.
 * It is supported to copy models in the root block.
 */
export class ReadOnlyClipboard extends LifeCycleWatcher {
  static override key = 'notesgraph-readonly-clipboard';

  protected readonly _copySelectedInPage = (
    onCopy?: () => void,
    onCopyError?: (error: unknown) => void
  ) => {
    return this.std.command
      .chain()
      .with({ onCopy, onCopyError })
      .pipe(getSelectedModelsCommand, { types: ['block', 'text', 'image'] })
      .pipe(draftSelectedModelsCommand)
      .pipe(copySelectedModelsCommand);
  };

  protected _disposables = new DisposableGroup();

  protected _initAdapters = () => {
    const copy = copyMiddleware(this.std);
    this.std.clipboard.use(copy);
    this.std.clipboard.use(
      titleMiddleware(this.std.store.workspace.meta.docMetas)
    );
    this.std.clipboard.use(defaultImageProxyMiddleware);

    this._disposables.add({
      dispose: () => {
        this.std.clipboard.unuse(copy);
        this.std.clipboard.unuse(
          titleMiddleware(this.std.store.workspace.meta.docMetas)
        );
        this.std.clipboard.unuse(defaultImageProxyMiddleware);
      },
    });
  };

  /**
   * Puts the selected text on the event's own clipboard, as plain text, and
   * says whether there was any. The rich copy that follows writes through
   * `navigator.clipboard`, which an Android WebView refuses ("Write
   * permission denied"); with the native copy prevented, nothing reached the
   * clipboard there. The event's clipboard needs no permission, and where the
   * rich copy works it replaces this.
   */
  protected readonly _setPlainText = (e: ClipboardEvent) => {
    const text =
      this.std.host.ownerDocument.getSelection()?.toString() ||
      this._selectedText();    if (!text || !e.clipboardData) return false;
    e.clipboardData.setData('text/plain', text);
    return true;
  };

  /**
   * The selection's plain text from the models, for when the browser has no
   * native selection to read: whole selected blocks, a text selection cut to
   * its range at both ends.
   */
  private readonly _selectedText = () => {
    const textSelection = this.std.selection.find(TextSelection);
    const [, { selectedModels }] = this.std.command.exec(
      getSelectedModelsCommand,
      { types: ['block', 'text'], mode: 'flat' }
    );
    return (selectedModels ?? [])
      .map(model => {
        const text = model.text?.toString() ?? '';
        if (!textSelection) return text;
        const { from, to } = textSelection;
        const start = model.id === from.blockId ? from.index : 0;
        const end = !to
          ? from.index + from.length
          : model.id === to.blockId
            ? to.index + to.length
            : text.length;
        return text.slice(start, end);
      })
      .join('\n');
  };

  onPageCopy: UIEventHandler = ctx => {
    const e = ctx.get('clipboardState').raw;
    e.preventDefault();
    this._setPlainText(e);

    this._copySelectedInPage().run();
  };

  override mounted(): void {
    if (!navigator.clipboard) {
      console.error(
        'navigator.clipboard is not supported in current environment.'
      );
      return;
    }
    if (this._disposables.disposed) {
      this._disposables = new DisposableGroup();
    }
    this.std.event.add('copy', this.onPageCopy);
    this._initAdapters();
  }
}
