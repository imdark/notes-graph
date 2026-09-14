import type { Container } from '@blocksuite/notesgraph/global/di';
import { ColorScheme } from '@blocksuite/notesgraph/model';
import {
  type ThemeExtension,
  ThemeExtensionIdentifier,
} from '@blocksuite/notesgraph/shared/services';
import {
  createSignalFromObservable,
  type Signal,
} from '@blocksuite/notesgraph/shared/utils';
import { LifeCycleWatcher, StdIdentifier } from '@blocksuite/notesgraph/std';
import { DocService, DocsService } from '@notesgraph/core/modules/doc';
import { AppThemeService } from '@notesgraph/core/modules/theme';
import { type FrameworkProvider } from '@notesgraph/infra';
import type { Observable } from 'rxjs';
import { combineLatest, map } from 'rxjs';

export function getThemeExtension(
  framework: FrameworkProvider
): typeof LifeCycleWatcher {
  class NotesGraphThemeExtension
    extends LifeCycleWatcher
    implements ThemeExtension
  {
    static override readonly key = 'notesgraph-theme';

    private readonly themes: Map<string, Signal<ColorScheme>> = new Map();

    protected readonly disposables: (() => void)[] = [];

    static override setup(di: Container) {
      super.setup(di);
      di.override(ThemeExtensionIdentifier, NotesGraphThemeExtension, [
        StdIdentifier,
      ]);
    }

    getAppTheme() {
      const keyName = 'app-theme';
      const cache = this.themes.get(keyName);
      if (cache) return cache;

      const theme$: Observable<ColorScheme> = framework
        .get(AppThemeService)
        .appTheme.theme$.map(theme => {
          return theme === ColorScheme.Dark
            ? ColorScheme.Dark
            : ColorScheme.Light;
        });
      const { signal: themeSignal, cleanup } =
        createSignalFromObservable<ColorScheme>(theme$, ColorScheme.Light);
      this.disposables.push(cleanup);
      this.themes.set(keyName, themeSignal);
      return themeSignal;
    }

    getEdgelessTheme(docId?: string) {
      const doc =
        (docId && framework.get(DocsService).list.doc$(docId).getValue()) ||
        framework.get(DocService).doc;

      const cache = this.themes.get(doc.id);
      if (cache) return cache;

      const appTheme$ = framework.get(AppThemeService).appTheme.theme$;
      const docTheme$ = doc.properties$.map(
        props => props.edgelessColorTheme || 'system'
      );
      const theme$: Observable<ColorScheme> = combineLatest([
        appTheme$,
        docTheme$,
      ]).pipe(
        map(([appTheme, docTheme]) => {
          const theme = docTheme === 'system' ? appTheme : docTheme;
          return theme === ColorScheme.Dark
            ? ColorScheme.Dark
            : ColorScheme.Light;
        })
      );
      const { signal: themeSignal, cleanup } =
        createSignalFromObservable<ColorScheme>(theme$, ColorScheme.Light);
      this.disposables.push(cleanup);
      this.themes.set(doc.id, themeSignal);
      return themeSignal;
    }

    override unmounted() {
      this.dispose();
    }

    dispose() {
      this.disposables.forEach(dispose => dispose());
    }
  }

  return NotesGraphThemeExtension;
}
