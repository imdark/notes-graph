export { ShareDocsListService } from './services/share-docs-list';
export { ShareInfoService } from './services/share-info';
export { PublishSiteService } from './services/publish-site';
export * from './publish-site-types';
export { readSiteManifest, readSiteRootId } from './site-manifest';

import { type Framework } from '@notesgraph/infra';

import { WorkspaceServerService } from '../cloud';
import { DocScope, DocService, DocsService } from '../doc';
import { DocsSearchService } from '../docs-search';
import { NbstoreService } from '../storage';
import { TagService } from '../tag';
import {
  WorkspaceLocalCache,
  WorkspaceScope,
  WorkspaceService,
} from '../workspace';
import { ShareDocsList } from './entities/share-docs-list';
import { ShareInfo } from './entities/share-info';
import { PublishSiteService } from './services/publish-site';
import { ShareDocsListService } from './services/share-docs-list';
import { ShareInfoService } from './services/share-info';
import { ShareStore } from './stores/share';
import { ShareDocsStore } from './stores/share-docs';

export function configureShareDocsModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(ShareDocsListService, [WorkspaceService])
    .store(ShareDocsStore, [WorkspaceServerService])
    .entity(ShareDocsList, [
      WorkspaceService,
      ShareDocsStore,
      WorkspaceLocalCache,
    ])
    .service(PublishSiteService, [
      WorkspaceService,
      DocsService,
      DocsSearchService,
      TagService,
      ShareStore,
    ])
    .store(ShareStore, [WorkspaceServerService, NbstoreService])
    .scope(DocScope)
    .service(ShareInfoService)
    .entity(ShareInfo, [WorkspaceService, DocService, ShareStore]);
}
