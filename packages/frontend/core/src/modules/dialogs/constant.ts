import type { DocMode } from '@blocksuite/notesgraph/model';

import type { WorkspaceMetadata } from '../workspace';

export type SettingTab =
  | 'shortcuts'
  | 'notifications'
  | 'appearance'
  | 'about'
  | 'plans'
  | 'billing'
  | 'backup' // electron only
  | 'experimental-features'
  | 'editor'
  | 'account'
  | 'meetings'
  | 'plugins'
  | `workspace:${'preference' | 'properties' | 'members' | 'storage' | 'billing' | 'license' | 'integrations' | 'embedding' | 'byok' | 'search' | 'agents' | 'folder-sync'}`;

export type GLOBAL_DIALOG_SCHEMA = {
  'create-workspace': (props: { serverId?: string }) => {
    metadata: WorkspaceMetadata;
    defaultDocId?: string;
  };
  'import-workspace': () => {
    workspace: WorkspaceMetadata;
  };
  'import-template': (props: {
    templateName: string;
    templateMode: DocMode;
    snapshotUrl: string;
  }) => void;
  'sign-in': (props: { server?: string; step?: string }) => void;
  'change-password': (props: {
    server?: string;
    hasPassword?: boolean;
  }) => void;
  'verify-email': (props: { server?: string; changeEmail?: boolean }) => void;
  'enable-cloud': (props: {
    workspaceId: string;
    openPageId?: string;
    serverId?: string;
  }) => boolean;
  'deleted-account': () => void;
  'uppy-upload': (props: {
    /** Base url of the backend server this workspace/account talks to. */
    serverBaseUrl: string;
    /** From `serverConfig.companionUrl`; omit/null disables remote sources. */
    companionUrl?: string | null;
    accept?: string;
    multiple?: boolean;
  }) => File[];
};

export type WORKSPACE_DIALOG_SCHEMA = {
  setting: (props: { activeTab?: SettingTab; scrollAnchor?: string }) => void;
  'doc-info': (props: { docId: string }) => void;
  'doc-selector': (props: {
    init: string[];
    onBeforeConfirm?: (ids: string[], cb: () => void) => void;
  }) => string[];
  'collection-selector': (props: {
    init: string[];
    onBeforeConfirm?: (ids: string[], cb: () => void) => void;
  }) => string[];
  'collection-editor': (props: {
    collectionId: string;
    mode?: 'page' | 'rule';
  }) => void;
  'tag-selector': (props: {
    init: string[];
    onBeforeConfirm?: (ids: string[], cb: () => void) => void;
  }) => string[];
  'date-selector': (props: {
    position?: [number, number, number, number]; // [x, y, width, height]
    onSelect?: (date?: string) => void;
  }) => string;
  'block-schedule': (props: {
    docId: string;
    blockId: string;
    text: string;
    position?: [number, number, number, number]; // [x, y, width, height]
  }) => void;
  import: () => {
    docIds: string[];
    entryId?: string;
    isWorkspaceFile?: boolean;
  };
  'project-members': (props: { projectId: string }) => void;
  'add-to-project': (props: { docId: string }) => void;
  'convert-to-project': (props: { docId: string }) => void;
  'link-visibility-confirm': (props: {
    sourceDocId: string;
    targetDocId: string;
  }) => void;
};
