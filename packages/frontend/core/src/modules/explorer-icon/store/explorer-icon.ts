import type { IconData } from '@notesgraph/component';
import { Store } from '@notesgraph/infra';
import { map } from 'rxjs';

import type { WorkspaceDBService } from '../../db';

export type ExplorerType = 'doc' | 'collection' | 'folder' | 'tag';

export class ExplorerIconStore extends Store {
  constructor(private readonly dbService: WorkspaceDBService) {
    super();
  }

  watchIcon(type: ExplorerType, id: string) {
    return this.dbService.db.explorerIcon.get$(`${type}:${id}`);
  }

  /** Reactively watch every doc icon as a map of docId -> icon. */
  watchDocIcons() {
    const prefix = 'doc:';
    return this.dbService.db.explorerIcon.find$().pipe(
      map(rows => {
        const result = new Map<string, IconData>();
        for (const row of rows) {
          if (row.id.startsWith(prefix) && row.icon) {
            result.set(row.id.slice(prefix.length), row.icon);
          }
        }
        return result;
      })
    );
  }

  getIcon(type: ExplorerType, id: string) {
    return this.dbService.db.explorerIcon.get(`${type}:${id}`);
  }

  setIcon(options: { where: ExplorerType; id: string; icon?: IconData }) {
    const { where, id, icon } = options;
    // remove icon
    if (!icon) {
      return this.dbService.db.explorerIcon.delete(`${where}:${id}`);
    }
    // upsert icon
    return this.dbService.db.explorerIcon.create({
      id: `${where}:${id}`,
      icon,
    });
  }
}
