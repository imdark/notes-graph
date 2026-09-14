import { Injectable } from '@nestjs/common';

import { OnJob } from '../../base';
import { DirectoryService } from './service';

declare global {
  interface Jobs {
    'directory.syncScope': {
      scopeId: string;
    };
  }
}

@Injectable()
export class DirectoryJob {
  constructor(private readonly directory: DirectoryService) {}

  @OnJob('directory.syncScope')
  async syncScope({ scopeId }: Jobs['directory.syncScope']) {
    await this.directory.syncScope(scopeId);
  }
}
