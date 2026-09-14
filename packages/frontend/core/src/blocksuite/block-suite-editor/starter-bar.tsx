import {
  AiIcon,
  EdgelessIcon,
  TemplateColoredIcon,
} from '@blocksuite/icons/rc';
import { PageRootBlockComponent } from '@blocksuite/notesgraph/blocks/root';
import type { Store } from '@blocksuite/notesgraph/store';
import { MenuSeparator } from '@notesgraph/component';
import { useEnableAI } from '@notesgraph/core/components/hooks/notesgraph/use-enable-ai';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { EditorService } from '@notesgraph/core/modules/editor';
import { TemplateDocService } from '@notesgraph/core/modules/template-doc';
import {
  TemplateListMenu,
  TemplateListMenuAdd,
} from '@notesgraph/core/modules/template-doc/view/template-list-menu';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import clsx from 'clsx';
import {
  forwardRef,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAsyncCallback } from '../../components/hooks/notesgraph-async-hooks';
import * as styles from './starter-bar.css';

const Badge = forwardRef<
  HTMLLIElement,
  HTMLAttributes<HTMLLIElement> & {
    icon: React.ReactNode;
    text: string;
    active?: boolean;
  }
>(function Badge({ icon, text, className, active, ...attrs }, ref) {
  return (
    <li
      data-active={active}
      className={clsx(styles.badge, className)}
      ref={ref}
      {...attrs}
    >
      <span className={styles.badgeText}>{text}</span>
      <span className={styles.badgeIcon}>{icon}</span>
    </li>
  );
});

const StarterBarNotEmpty = ({ doc }: { doc: Store }) => {
  const t = useI18n();

  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);
  const editorService = useService(EditorService);
  const docModes = useLiveData(useService(DocModeRegistryService).modes$);

  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  const isTemplate = useLiveData(
    useMemo(
      () => templateDocService.list.isTemplate$(doc.id),
      [doc.id, templateDocService.list]
    )
  );
  const enableAI = useEnableAI();

  const handleSelectTemplate = useAsyncCallback(
    async (templateId: string) => {
      await docsService.duplicateFromTemplate(templateId, doc.id);
      track.doc.editor.starterBar.quickStart({ with: 'template' });
    },
    [doc.id, docsService]
  );

  const startWithEdgeless = useCallback(() => {
    const record = docsService.list.doc$(doc.id).value;
    record?.setPrimaryMode('edgeless');
    editorService.editor.setMode('edgeless');
  }, [doc.id, docsService.list, editorService.editor]);

  const onTemplateMenuOpenChange = useCallback((open: boolean) => {
    if (open) track.doc.editor.starterBar.openTemplateListMenu();
    setTemplateMenuOpen(open);
  }, []);

  const startWithAI = useCallback(() => {
    const std = editorService.editor.editorContainer$.value?.std;
    if (!std) return;

    const rootBlockId = std.host.store.root?.id;
    if (!rootBlockId) return;

    const rootComponent = std.view.getBlock(rootBlockId);
    if (!(rootComponent instanceof PageRootBlockComponent)) return;

    // Imported on demand: the blocksuite/ai barrel is ~9MB and stays out of the
    // initial bundle; the user is clicking "start with AI" so the wait is fine.
    void import('@notesgraph/core/blocksuite/ai').then(
      ({ handleInlineAskAIAction, pageAIGroups }) => {
        const { id, created } = rootComponent.focusFirstParagraph();
        if (created) {
          const subscription = std.view.viewUpdated.subscribe(v => {
            if (v.id === id) {
              subscription.unsubscribe();
              handleInlineAskAIAction(std.host, pageAIGroups);
            }
          });
        } else {
          handleInlineAskAIAction(std.host, pageAIGroups);
        }
      }
    );
  }, [editorService.editor]);

  const showTemplate = !isTemplate;

  if (!enableAI && !showTemplate) {
    return null;
  }

  return (
    <div className={styles.root} data-testid="starter-bar">
      {t['com.notesgraph.page-starter-bar.start']()}
      <ul className={styles.badges}>
        {enableAI ? (
          <Badge
            data-testid="start-with-ai-badge"
            icon={<AiIcon className={styles.aiIcon} />}
            text={t['com.notesgraph.page-starter-bar.ai']()}
            onClick={startWithAI}
          />
        ) : null}

        {showTemplate ? (
          <TemplateListMenu
            onSelect={handleSelectTemplate}
            rootOptions={{
              open: templateMenuOpen,
              onOpenChange: onTemplateMenuOpenChange,
            }}
            suffixItems={
              <>
                <MenuSeparator />
                <TemplateListMenuAdd />
              </>
            }
          >
            <Badge
              data-testid="template-docs-badge"
              icon={<TemplateColoredIcon />}
              text={t['com.notesgraph.page-starter-bar.template']()}
              active={templateMenuOpen}
            />
          </TemplateListMenu>
        ) : null}

        {docModes.length > 1 && (
          <Badge
            icon={<EdgelessIcon />}
            text={t['com.notesgraph.page-starter-bar.edgeless']()}
            onClick={startWithEdgeless}
          />
        )}
      </ul>
    </div>
  );
};

export const StarterBar = ({ doc }: { doc: Store }) => {
  const [isEmpty, setIsEmpty] = useState(doc.isEmpty);
  const templateDocService = useService(TemplateDocService);

  const isTemplate = useLiveData(
    useMemo(
      () => templateDocService.list.isTemplate$(doc.id),
      [doc.id, templateDocService.list]
    )
  );

  useEffect(() => {
    return doc.isEmpty$.subscribe(value => {
      setIsEmpty(value);
    });
  }, [doc]);

  if (!isEmpty || isTemplate) return null;

  return <StarterBarNotEmpty doc={doc} />;
};
