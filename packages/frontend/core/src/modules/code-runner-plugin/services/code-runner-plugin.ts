import { OnEvent, Service } from '@notesgraph/infra';

import { ApplicationStarted } from '../../lifecycle';
import type { PluginService } from '../../plugin';
import { codeRunnerPluginDefinition } from '../definition';
import { codeRunnerManifest } from '../manifest';

/** Registers the code runner as a built-in plugin (off until enabled). */
@OnEvent(ApplicationStarted, e => e.register)
export class CodeRunnerPluginService extends Service {
  constructor(private readonly pluginService: PluginService) {
    super();
  }

  register() {
    this.pluginService.registerBuiltin(
      codeRunnerManifest,
      codeRunnerPluginDefinition
    );
  }
}
