import { Service } from '@notesgraph/infra';

import { WorkspaceInvoices } from '../entities/workspace-invoices';

export class WorkspaceInvoicesService extends Service {
  invoices = this.framework.createEntity(WorkspaceInvoices);
}
