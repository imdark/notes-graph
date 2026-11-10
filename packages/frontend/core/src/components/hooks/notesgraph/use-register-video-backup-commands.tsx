import { DownloadIcon } from '@blocksuite/icons/rc';
import { toast } from '@notesgraph/component';
import { registerNotesGraphCommand } from '@notesgraph/core/commands';
import type { Editor } from '@notesgraph/core/modules/editor';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import {
  backupVideoBlock,
  videosWithoutBackup,
  workspaceFileLimit,
} from '@notesgraph/core/modules/video-ingestion';
import { useFramework, useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

/**
 * "Back up YouTube videos in this note" in the Cmd/Ctrl+K palette: downloads
 * every YouTube video in the open note that has no backup yet, one at a
 * time, and saves each as a playable attachment below its link. Listed only
 * while the note has a video without a backup.
 */
export function useRegisterVideoBackupCommands(
  editor: Editor,
  active: boolean
) {
  const enabled = useLiveData(
    useService(FeatureFlagService).flags.enable_youtube_backup.$
  );
  const framework = useFramework();

  useEffect(() => {
    if (!active || !enabled) return;
    const store = editor.doc.blockSuiteDoc;
    let running = false;

    return registerNotesGraphCommand({
      id: 'editor:page-backup-youtube-videos',
      category: 'editor:page',
      preconditionStrategy: () =>
        !running && videosWithoutBackup(store).length > 0,
      icon: <DownloadIcon />,
      label: {
        title: 'Back up YouTube videos in this note',
        subTitle:
          'Download each video and save it below its link, in case YouTube removes it',
      },
      run: () => {
        const videos = videosWithoutBackup(store);
        if (videos.length === 0) return;
        running = true;
        const total = videos.length;
        toast(
          total === 1
            ? 'Downloading the video to back it up…'
            : `Downloading ${total} videos to back them up…`
        );
        (async () => {
          let saved = 0;
          const failures: string[] = [];
          for (const model of videos) {
            try {
              if (
                (await backupVideoBlock(
                  store,
                  model,
                  workspaceFileLimit(framework)
                )) === 'saved'
              )
                saved++;
            } catch (err) {
              console.error('[NG-DIAG video-backup] backup failed:', err);
              failures.push(err instanceof Error ? err.message : String(err));
            }
          }
          running = false;
          toast(
            failures.length === 0
              ? `Backed up ${saved} of ${total} video${total === 1 ? '' : 's'}`
              : `Backed up ${saved} of ${total}; ${failures.length} failed: ${failures[0]}`
          );
        })().catch((err: unknown) => {
          running = false;
          console.error('[NG-DIAG video-backup] backup failed:', err);
        });
      },
    });
  }, [editor, active, enabled, framework]);
}
