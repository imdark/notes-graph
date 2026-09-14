import { type Framework } from '@notesgraph/infra';

import { DocsService } from '../doc';
import { WorkspaceScope } from '../workspace';
import { ScheduleService } from './services/schedule';

export * from './recurrence';
export {
  type ScheduledDoc,
  type ScheduleOccurrence,
  ScheduleService,
} from './services/schedule';

export function configureScheduleModule(framework: Framework) {
  framework.scope(WorkspaceScope).service(ScheduleService, [DocsService]);
}
