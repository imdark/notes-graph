import type { Framework } from '@notesgraph/infra';

import { DocModeRegistryService } from './services/doc-mode-registry';

export { pageDocMode } from './page-mode';
export { DocModeRegistryService } from './services/doc-mode-registry';
export type {
  DocModeDescriptor,
  DocModeEditorComponent,
  DocModeEditorProps,
} from './types';

export function configureDocModeRegistryModule(framework: Framework) {
  framework.service(DocModeRegistryService);
}
