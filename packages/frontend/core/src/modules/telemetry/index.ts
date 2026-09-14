import { type Framework } from '@notesgraph/infra';

import { ServersService } from '../cloud';
import { GlobalContextService } from '../global-context';
import { TelemetryService } from './services/telemetry';

export function configureTelemetryModule(framework: Framework) {
  framework.service(TelemetryService, [GlobalContextService, ServersService]);
}
