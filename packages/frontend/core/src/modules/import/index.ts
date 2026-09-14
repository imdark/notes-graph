import type { Framework } from '@notesgraph/infra';

import { ImportRegistryService } from './services/import-registry';

export {
  type ImporterResult,
  type ImporterSpec,
  ImportRegistryService,
  type RegisteredImporter,
} from './services/import-registry';

export function configureImportModule(framework: Framework) {
  framework.service(ImportRegistryService);
}
