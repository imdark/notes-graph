import { AllDocsIcon } from '@blocksuite/icons/rc';
import { Button } from '@notesgraph/component';
import { AuthHeader } from '@notesgraph/component/auth-components';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { useWorkspaceName } from '@notesgraph/core/components/hooks/use-workspace-info';
import { WorkspaceSelector } from '@notesgraph/core/components/workspace-selector';
import { AuthService, ServerService } from '@notesgraph/core/modules/cloud';
import {
  type ClipperInput,
  ImportClipperService,
} from '@notesgraph/core/modules/import-clipper';
import {
  type WorkspaceMetadata,
  WorkspacesService,
} from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import { cssVar } from '@toeverything/theme';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as styles from './style.css';

// A clip arrives in two messages: a pending one with just the title and link,
// so the note is made at once, then the full one with the page content. An
// older clipper sends only the full one. The clipper repeats each message
// until it is answered, so the first copy is kept and later ones only replace
// the port to answer on.
const pendingInput$ = new LiveData<ClipperInput | null>(null);
const fullInput$ = new LiveData<ClipperInput | null>(null);
const pendingPort$ = new LiveData<MessagePort | null>(null);
const fullPort$ = new LiveData<MessagePort | null>(null);

window.addEventListener('message', event => {
  if (
    typeof event.data === 'object' &&
    event.data.type === 'notesgraph-clipper:import'
  ) {
    const payload: ClipperInput = event.data.payload;
    const input$ = payload.pending ? pendingInput$ : fullInput$;
    const port$ = payload.pending ? pendingPort$ : fullPort$;
    if (!input$.value) input$.value = payload;
    if (event.ports.length > 0) {
      port$.value = event.ports[0];
    }
  }
});

function reply(port: MessagePort | null, type: string) {
  const arg = { type };
  if (port) {
    port.postMessage(arg);
  } else {
    window.postMessage(arg);
  }
}

export const Component = () => {
  const importClipperService = useService(ImportClipperService);
  const t = useI18n();
  const session = useService(AuthService).session;
  const notLogin = useLiveData(session.status$) === 'unauthenticated';

  const [importing, setImporting] = useState(false);
  const [importingError, setImportingError] = useState<any>(null);
  const pendingInput = useLiveData(pendingInput$);
  const fullInput = useLiveData(fullInput$);
  // What a new note is made from: the full clip if it is already here.
  const clipperInput = fullInput ?? pendingInput;
  // A note made from the pending clip, waiting for the full one.
  const [pendingDoc, setPendingDoc] = useState<{
    workspace: WorkspaceMetadata;
    docId: string;
  } | null>(null);
  const fillStarted = useRef(false);
  const isMissingInput = !clipperInput;
  const workspaceStrategy = clipperInput?.workspace ?? 'select-by-user';
  const serverService = useService(ServerService);
  const workspacesService = useService(WorkspacesService);
  const serverConfig = useLiveData(serverService.server.config$);
  const workspaces = useLiveData(workspacesService.list.workspaces$);
  const [rawSelectedWorkspace, setSelectedWorkspace] =
    useState<WorkspaceMetadata | null>(null);
  const [lastOpenedWorkspaceId] = useState(() =>
    localStorage.getItem('last_workspace_id')
  );
  const selectedWorkspace =
    rawSelectedWorkspace ??
    workspaces.find(w => w.id === lastOpenedWorkspaceId) ??
    workspaces.find(w => w.flavour !== 'local') ??
    workspaces.at(0);
  const selectedWorkspaceName = useWorkspaceName(selectedWorkspace);

  const noWorkspace = workspaces.length === 0;

  useEffect(() => {
    workspacesService.list.revalidate();
  }, [workspacesService]);

  useEffect(() => {
    session.revalidate();
  }, [session]);

  const handleSelectedWorkspace = useCallback(
    (workspaceMetadata: WorkspaceMetadata) => {
      return setSelectedWorkspace(workspaceMetadata);
    },
    []
  );

  const handleCreatedWorkspace = useCallback(
    (payload: { metadata: WorkspaceMetadata; defaultDocId?: string }) => {
      return setSelectedWorkspace(payload.metadata);
    },
    []
  );

  const handleSuccess = useCallback(() => {
    track.clipper.$.$.createDoc();
    reply(fullPort$.value, 'notesgraph-clipper:import:success');
    window.close();
  }, []);

  // Once a note exists: done if it holds the full clip, otherwise tell the
  // clipper the note is made and wait for the page content.
  const handleCreated = useCallback(
    (input: ClipperInput, workspace: WorkspaceMetadata, docId: string) => {
      if (input.pending) {
        reply(pendingPort$.value, 'notesgraph-clipper:import:created');
        setPendingDoc({ workspace, docId });
      } else {
        handleSuccess();
      }
    },
    [handleSuccess]
  );

  const handleImportToSelectedWorkspace = useAsyncCallback(async () => {
    if (clipperInput && selectedWorkspace) {
      // save the last opened workspace id
      localStorage.setItem('last_workspace_id', selectedWorkspace.id);
      setImporting(true);
      try {
        const docId = await importClipperService.importToWorkspace(
          selectedWorkspace,
          clipperInput
        );
        handleCreated(clipperInput, selectedWorkspace, docId);
      } catch (err) {
        setImportingError(err);
      } finally {
        setImporting(false);
      }
    }
  }, [clipperInput, handleCreated, importClipperService, selectedWorkspace]);

  const handleImportToNewWorkspace = useAsyncCallback(async () => {
    if (!clipperInput) {
      return;
    }
    setImporting(true);
    try {
      const flavour = 'notesgraph-cloud';
      const { workspaceId, docId } =
        await importClipperService.importToNewWorkspace(
          flavour,
          'Workspace',
          clipperInput
        );
      handleCreated(clipperInput, { id: workspaceId, flavour }, docId);
    } catch (err) {
      setImportingError(err);
    } finally {
      setImporting(false);
    }
  }, [clipperInput, handleCreated, importClipperService]);

  useEffect(() => {
    if (!pendingDoc || !fullInput || fillStarted.current) return;
    fillStarted.current = true;
    setImporting(true);
    importClipperService
      .fillClippedDoc(pendingDoc.workspace, pendingDoc.docId, fullInput)
      .then(handleSuccess)
      .catch(err => {
        setImportingError(err);
        setImporting(false);
      });
  }, [pendingDoc, fullInput, importClipperService, handleSuccess]);

  // The note is made but the page content hasn't come yet.
  const waitingForContent = !!pendingDoc && !importingError;

  const handleClickSignIn = useCallback(() => {
    window.open(
      `/sign-in?redirect_uri=${encodeURIComponent('CLOSE_POPUP')}`,
      '_blank',
      'popup'
    );
  }, []);

  const autoImportTriggered = useRef(false);

  useEffect(() => {
    if (isMissingInput) {
      return;
    }
    // use ref to avoid multiple auto import
    // and make sure the following code only runs once
    if (autoImportTriggered.current) {
      return;
    }
    autoImportTriggered.current = true;

    // if not login, we don't auto import
    if (notLogin) {
      return;
    }

    // if the workspace strategy is last-open-workspace, we automatically click the import button
    if (
      workspaceStrategy === 'last-open-workspace' &&
      selectedWorkspace?.id === lastOpenedWorkspaceId
    ) {
      handleImportToSelectedWorkspace();
    }
  }, [
    workspaceStrategy,
    selectedWorkspace,
    handleImportToSelectedWorkspace,
    lastOpenedWorkspaceId,
    isMissingInput,
    notLogin,
  ]);

  // Once the note is made, importing again would make a second one.
  const disabled = isMissingInput || importing || notLogin || !!pendingDoc;

  if (notLogin) {
    // not login
    return (
      <div className={styles.container}>
        <AuthHeader
          className={styles.authHeader}
          title={t['com.notesgraph.auth.sign.in']()}
          subTitle={serverConfig.serverName}
        />
        <Button
          className={styles.mainButton}
          variant="primary"
          onClick={handleClickSignIn}
        >
          {t['com.notesgraph.auth.sign.in']()}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <AllDocsIcon className={styles.mainIcon} />
      <h6 className={styles.mainTitle}>
        {t['com.notesgraph.import-clipper.dialog.createDocFromClipper']()}
      </h6>
      {waitingForContent ? (
        <p className={styles.desc}>
          Note created. Adding the page’s text and images…
        </p>
      ) : noWorkspace ? (
        <p className={styles.desc}>A new workspace will be created.</p>
      ) : (
        <>
          <p className={styles.desc}>Choose a workspace.</p>
          <WorkspaceSelector
            workspaceMetadata={selectedWorkspace}
            onSelectWorkspace={handleSelectedWorkspace}
            onCreatedWorkspace={handleCreatedWorkspace}
            className={styles.workspaceSelector}
            showArrowDownIcon
            disable={disabled}
            menuContentOptions={{
              side: 'top',
              style: {
                maxHeight: 'min(600px, calc(50vh + 50px))',
                width: 352,
                maxWidth: 'calc(100vw - 20px)',
              },
            }}
          />
        </>
      )}
      <div className={styles.buttonContainer}>
        {importingError && (
          <span style={{ color: cssVar('warningColor') }}>
            {t['com.notesgraph.import-clipper.dialog.errorImport']()}
          </span>
        )}
        {isMissingInput ? (
          <span style={{ color: cssVar('warningColor') }}>
            {t['com.notesgraph.import-clipper.dialog.errorLoad']()}
          </span>
        ) : selectedWorkspace ? (
          <Button
            className={styles.mainButton}
            variant={disabled ? 'secondary' : 'primary'}
            loading={disabled}
            disabled={disabled}
            onClick={handleImportToSelectedWorkspace}
            data-testid="import-clipper-to-workspace-btn"
          >
            {selectedWorkspaceName &&
              t['com.notesgraph.import-clipper.dialog.createDocToWorkspace']({
                workspace: selectedWorkspaceName,
              })}
          </Button>
        ) : (
          <Button
            className={styles.mainButton}
            variant="primary"
            loading={disabled}
            disabled={disabled}
            onClick={handleImportToNewWorkspace}
          >
            {t[
              'com.notesgraph.import-clipper.dialog.createDocToNewWorkspace'
            ]()}
          </Button>
        )}
      </div>
    </div>
  );
};
