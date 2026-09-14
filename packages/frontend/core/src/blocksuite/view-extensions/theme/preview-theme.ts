import type { Container } from '@blocksuite/global/di';
import { ColorScheme } from '@blocksuite/notesgraph/model';
import {
  type ThemeExtension,
  ThemeExtensionIdentifier,
} from '@blocksuite/notesgraph/shared/services';
import {
  createSignalFromObservable,
  type Signal,
} from '@blocksuite/notesgraph/shared/utils';
import {
  type BlockStdScope,
  LifeCycleWatcher,
  StdIdentifier,
} from '@blocksuite/notesgraph/std';
import { AppThemeService } from '@notesgraph/core/modules/theme';
import type { FrameworkProvider } from '@notesgraph/infra';
import type { Observable } from 'rxjs';

export function getPreviewThemeExtension(framework: FrameworkProvider) {
  class NotesGraphPagePreviewThemeExtension
    extends LifeCycleWatcher
    implements ThemeExtension
  {
    static override readonly key = 'notesgraph-page-preview-theme';

    readonly theme: Signal<ColorScheme>;

    readonly disposables: (() => void)[] = [];

    static override setup(di: Container) {
      super.setup(di);
      di.override(
        ThemeExtensionIdentifier,
        NotesGraphPagePreviewThemeExtension,
        [StdIdentifier]
      );
    }

    constructor(std: BlockStdScope) {
      super(std);
      const theme$: Observable<ColorScheme> = framework
        .get(AppThemeService)
        .appTheme.theme$.map(theme => {
          return theme === ColorScheme.Dark
            ? ColorScheme.Dark
            : ColorScheme.Light;
        });
      const { signal, cleanup } = createSignalFromObservable<ColorScheme>(
        theme$,
        ColorScheme.Light
      );
      this.theme = signal;
      this.disposables.push(cleanup);
    }

    getAppTheme() {
      return this.theme;
    }

    getEdgelessTheme() {
      return this.theme;
    }

    override unmounted() {
      this.dispose();
    }

    dispose() {
      this.disposables.forEach(dispose => dispose());
    }
  }

  return NotesGraphPagePreviewThemeExtension;
}
