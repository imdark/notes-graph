import type { Framework } from '@notesgraph/infra';

import { PluginService } from '../plugin';
import { CodeRunnerPluginService } from './services/code-runner-plugin';

export { CODE_RUNNER_PLUGIN_ID, codeRunnerManifest } from './manifest';
export { CodeRunnerPluginService } from './services/code-runner-plugin';

export function configureCodeRunnerPluginModule(framework: Framework) {
  framework.service(CodeRunnerPluginService, [PluginService]);
}
