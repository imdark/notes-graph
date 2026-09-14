import { LiveData, Service } from '@notesgraph/infra';
import type { ReactNode } from 'react';

export interface ImporterResult {
  /** Docs created by the import; lets the dialog navigate to them. */
  docIds?: string[];
}

export interface ImporterSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  /** File `accept` string, e.g. `.json,.txt`. Omit to accept any file. */
  accept?: string;
  multiple?: boolean;
  run: (
    files: File[]
  ) => void | ImporterResult | Promise<void | ImporterResult>;
}

export interface RegisteredImporter {
  owner: string;
  spec: ImporterSpec;
}

/**
 * Registry of import options contributed by modules/plugins. The import dialog
 * renders these alongside its built-in importers. Plugins register via
 * `ctx.ui.addImporter(...)`.
 */
export class ImportRegistryService extends Service {
  readonly importers$ = new LiveData<RegisteredImporter[]>([]);

  register(owner: string, spec: ImporterSpec): () => void {
    this.importers$.next([...this.importers$.value, { owner, spec }]);
    return () =>
      this.importers$.next(
        this.importers$.value.filter(
          i => !(i.owner === owner && i.spec.id === spec.id)
        )
      );
  }
}
