import { ColorScheme } from '@blocksuite/notesgraph/model';
import { createSignalFromObservable } from '@blocksuite/notesgraph-shared/utils';
import { Entity, LiveData } from '@notesgraph/infra';
import type { Signal } from '@preact/signals-core';

export class AppTheme extends Entity {
  theme$ = new LiveData<string | undefined>(undefined);

  themeSignal: Signal<ColorScheme>;

  constructor() {
    super();
    const { signal, cleanup } = createSignalFromObservable<ColorScheme>(
      this.theme$.map(theme =>
        theme === 'dark' ? ColorScheme.Dark : ColorScheme.Light
      ),
      ColorScheme.Light
    );
    this.themeSignal = signal;
    this.disposables.push(cleanup);
  }
}
