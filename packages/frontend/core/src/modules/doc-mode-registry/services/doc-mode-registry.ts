import { LiveData, Service } from '@notesgraph/infra';

import { pageDocMode } from '../page-mode';
import type { DocModeDescriptor } from '../types';

/**
 * Holds the set of available doc editing modes. "page" is seeded as the built-in
 * mode; plugins register/unregister additional modes (e.g. "edgeless") via the
 * `docModes` plugin capability. Core UI surfaces subscribe to {@link modes$} so
 * the mode toggle, create menus, primary-mode property, and new-doc-default
 * setting all reflect the registered modes without hardcoding any of them.
 */
export class DocModeRegistryService extends Service {
  readonly modes$ = new LiveData<DocModeDescriptor[]>([pageDocMode]);

  /** Modes offered when creating docs / as a new-doc default. */
  readonly creatableModes$ = this.modes$.map(modes =>
    modes.filter(mode => mode.creatable)
  );

  /** View-extension providers contributed by all registered modes. */
  readonly viewExtensions$ = this.modes$.map(modes =>
    modes.flatMap(mode => mode.viewExtensions ?? [])
  );

  /** Register (or replace) a mode. Returns a disposer that removes it again. */
  register(descriptor: DocModeDescriptor) {
    const next = [
      ...this.modes$.value.filter(mode => mode.id !== descriptor.id),
      descriptor,
    ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.modes$.next(next);
    return () => {
      this.modes$.next(this.modes$.value.filter(mode => mode !== descriptor));
    };
  }

  get(id: string): DocModeDescriptor | undefined {
    return this.modes$.value.find(mode => mode.id === id);
  }
}
