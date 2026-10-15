import { ExportToMarkdownIcon } from '@blocksuite/icons/rc';
import { notify } from '@notesgraph/component';
import { MenuItem } from '@notesgraph/component/ui/menu';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import {
  isSkillNoteTitle,
  RemoteAgentRunnerService,
} from '@notesgraph/core/modules/agents';
import { EditorService } from '@notesgraph/core/modules/editor';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { downloadBlob } from '@notesgraph/core/utils/resource';
import { useLiveData, useService } from '@notesgraph/infra';

/**
 * A note titled "Skill: <name>" downloads as the SKILL.md an agent run gets
 * from it, to use as a Claude Code skill anywhere. The server renders it
 * (plugins/registry/skill-notes.ts), so the file is the one runs load.
 */
export const ExportSkillMenuItem = () => {
  const workspace = useService(WorkspaceService).workspace;
  const editorService = useService(EditorService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const doc = editorService.editor.doc;
  const title = useLiveData(doc.title$);

  const handleExport = useAsyncCallback(async () => {
    try {
      const text = await remoteRunner.skillNoteMd(workspace.id, doc.id);
      const name = /^name:\s*(\S+)/m.exec(text)?.[1] ?? 'skill';
      await downloadBlob(
        new Blob([text], { type: 'text/markdown' }),
        `${name}-SKILL.md`
      );
    } catch (error) {
      notify.error({
        title: 'Could not export the skill',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [doc.id, remoteRunner, workspace.id]);

  // The server renders it, so a local workspace has nothing to ask.
  if (workspace.flavour === 'local' || !isSkillNoteTitle(title)) {
    return null;
  }
  return (
    <MenuItem
      prefixIcon={<ExportToMarkdownIcon />}
      data-testid="editor-option-menu-export-skill"
      onSelect={handleExport}
    >
      Export as SKILL.md
    </MenuItem>
  );
};
