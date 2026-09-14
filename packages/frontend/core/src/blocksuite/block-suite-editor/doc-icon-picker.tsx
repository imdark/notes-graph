import { ImageIcon, SmileSolidIcon } from '@blocksuite/icons/rc';
import {
  Button,
  IconEditor,
  IconRenderer,
  IconType,
  toast,
} from '@notesgraph/component';
import { EditorSettingService } from '@notesgraph/core/modules/editor-setting';
import { ExplorerIconService } from '@notesgraph/core/modules/explorer-icon/services/explorer-icon';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';

import {
  AiIconGenerator,
  blobToIconDataUrl,
  DocBannerGenerateButton,
} from './doc-banner';
import * as styles from './doc-icon-picker.css';

const TitleContainer = ({
  children,
  hasIcon,
}: {
  children: React.ReactNode;
  hasIcon: boolean;
}) => {
  return (
    <div
      className="doc-icon-container"
      data-has-icon={hasIcon ? 'true' : 'false'}
      style={{
        paddingBottom: 8,
      }}
    >
      {children}
    </div>
  );
};

export const DocIconPicker = ({
  docId,
  readonly,
}: {
  docId: string;
  readonly?: boolean;
}) => {
  const t = useI18n();
  const explorerIconService = useService(ExplorerIconService);
  const editorSetting = useService(EditorSettingService).editorSetting;

  const icon = useLiveData(explorerIconService.icon$('doc', docId));
  const settings = useLiveData(editorSetting.settings$);

  const isPlaceholder = !icon?.icon;
  const shouldShowAddIconOption = settings.displayAddIconOption;

  // Upload a custom image as the note icon — reuses the same Blob icon data
  // (a downscaled data URL) that the AI generator produces, so it renders and
  // stores identically. Not gated behind AI support.
  const uploadIcon = (close: () => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      blobToIconDataUrl(file)
        .then(url => {
          explorerIconService.setIcon({
            where: 'doc',
            id: docId,
            icon: { type: IconType.Blob, url },
          });
          toast('Icon applied');
          close();
        })
        .catch(err => {
          console.error('[doc-icon-picker] icon upload failed:', err);
          toast('Could not apply the icon');
        });
    };
    input.click();
  };

  if (readonly) {
    return isPlaceholder ? null : (
      <div
        className={styles.docIconPickerTrigger}
        data-icon-type={icon?.icon?.type}
      >
        <IconRenderer data={icon.icon} />
      </div>
    );
  }

  if (isPlaceholder && !shouldShowAddIconOption) {
    return null;
  }

  return (
    <TitleContainer hasIcon={!isPlaceholder}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconEditor
          icon={icon?.icon}
          onIconChange={data => {
            explorerIconService.setIcon({
              where: 'doc',
              id: docId,
              icon: data,
            });
          }}
          closeAfterSelect={true}
          triggerVariant="plain"
          triggerClassName={
            isPlaceholder ? styles.placeholder : styles.docIconPickerTrigger
          }
          iconPlaceholder={
            <div className={styles.placeholderContent}>
              <SmileSolidIcon className={styles.placeholderContentIcon} />
              <span className={styles.placeholderContentText}>
                {t['com.notesgraph.docIconPicker.placeholder']()}
              </span>
            </div>
          }
          extraContent={close => (
            <>
              <div className={styles.uploadSection}>
                <Button
                  variant="secondary"
                  size="default"
                  prefix={<ImageIcon />}
                  onClick={() => uploadIcon(close)}
                >
                  {t['com.notesgraph.docIconPicker.upload']()}
                </Button>
              </div>
              <AiIconGenerator
                docId={docId}
                onSelect={data => {
                  explorerIconService.setIcon({
                    where: 'doc',
                    id: docId,
                    icon: data,
                  });
                }}
                onApplied={close}
              />
            </>
          )}
        />
        <DocBannerGenerateButton docId={docId} readonly={readonly} />
      </div>
    </TitleContainer>
  );
};
