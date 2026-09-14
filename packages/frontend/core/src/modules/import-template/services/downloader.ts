import { Service } from '@notesgraph/infra';

import { TemplateDownloader } from '../entities/downloader';

export class TemplateDownloaderService extends Service {
  downloader = this.framework.createEntity(TemplateDownloader);
}
