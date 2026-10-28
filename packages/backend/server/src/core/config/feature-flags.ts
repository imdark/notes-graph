import { Controller, Get } from '@nestjs/common';

import { Config } from '../../base';
import { Public } from '../auth';

@Controller('/api/server')
export class FeatureFlagsController {
  constructor(private readonly config: Config) {}

  /**
   * The app feature flags an admin turned on or off for everyone (config
   * `flags.featureOverrides`, set from the Feature flags page through
   * updateAppConfig). Public: the app applies them before anyone signs in.
   */
  @Public()
  @Get('/feature-flags')
  featureFlags(): { overrides: Record<string, boolean> } {
    return { overrides: this.config.flags.featureOverrides ?? {} };
  }
}
