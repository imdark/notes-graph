import {
  CommentIcon,
  LockIcon,
  SingleSelectCheckSolidIcon,
  ViewIcon,
} from '@blocksuite/icons/rc';
import { Menu, MenuItem, MenuTrigger, notify } from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { EditorService } from '@notesgraph/core/modules/editor';
import { ShareInfoService } from '@notesgraph/core/modules/share-doc';
import { UserFriendlyError } from '@notesgraph/error';
import { DocRole, PublicDocMode } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import { cssVar } from '@toeverything/theme';
import clsx from 'clsx';
import { useEffect } from 'react';

import * as styles from './styles.css';

export const PublicDoc = ({ disabled }: { disabled?: boolean }) => {
  const t = useI18n();
  const editorService = useService(EditorService);
  const shareInfoService = useService(ShareInfoService);
  const isSharedPage = useLiveData(shareInfoService.shareInfo.isShared$);
  const publicRole = useLiveData(shareInfoService.shareInfo.publicRole$);
  const isCommentable = isSharedPage && publicRole === DocRole.Commenter;
  const isRevalidating = useLiveData(
    shareInfoService.shareInfo.isRevalidating$
  );
  const currentMode = useLiveData(editorService.editor.mode$);

  useEffect(() => {
    shareInfoService.shareInfo.revalidate();
  }, [shareInfoService]);

  const onDisablePublic = useAsyncCallback(async () => {
    try {
      await shareInfoService.shareInfo.disableShare();
      notify.error({
        title:
          t[
            'com.notesgraph.share-menu.disable-publish-link.notification.success.title'
          ](),
        message:
          t[
            'com.notesgraph.share-menu.disable-publish-link.notification.success.message'
          ](),
      });
    } catch (err) {
      notify.error({
        title:
          t[
            'com.notesgraph.share-menu.disable-publish-link.notification.fail.title'
          ](),
        message:
          t[
            'com.notesgraph.share-menu.disable-publish-link.notification.fail.message'
          ](),
      });
      console.log(err);
    }
  }, [shareInfoService, t]);

  const onClickAnyoneReadOnlyShare = useAsyncCallback(async () => {
    if (isSharedPage && !isCommentable) {
      return;
    }
    try {
      // TODO(@JimmFly): remove mode when we have a better way to handle it
      await shareInfoService.shareInfo.enableShare(
        currentMode === 'edgeless'
          ? PublicDocMode.Edgeless
          : PublicDocMode.Page,
        DocRole.Reader
      );
      track.$.sharePanel.$.createShareLink();
      notify.success({
        title:
          t[
            'com.notesgraph.share-menu.create-public-link.notification.success.title'
          ](),
        message:
          t[
            'com.notesgraph.share-menu.create-public-link.notification.success.message'
          ](),
        style: 'normal',
        icon: <SingleSelectCheckSolidIcon color={cssVar('primaryColor')} />,
      });
    } catch (error) {
      const err = UserFriendlyError.fromAny(error);
      notify.error({
        title: err.name,
        message: err.message,
      });
    }
  }, [currentMode, isCommentable, isSharedPage, shareInfoService.shareInfo, t]);

  const onClickAnyoneCommentShare = useAsyncCallback(async () => {
    if (isCommentable) {
      return;
    }
    try {
      await shareInfoService.shareInfo.enableShare(
        currentMode === 'edgeless'
          ? PublicDocMode.Edgeless
          : PublicDocMode.Page,
        DocRole.Commenter
      );
      track.$.sharePanel.$.createShareLink();
      notify.success({
        title:
          t[
            'com.notesgraph.share-menu.create-public-link.notification.success.title'
          ](),
        message:
          t[
            'com.notesgraph.share-menu.create-public-link.notification.success.message'
          ](),
        style: 'normal',
        icon: <SingleSelectCheckSolidIcon color={cssVar('primaryColor')} />,
      });
    } catch (error) {
      const err = UserFriendlyError.fromAny(error);
      notify.error({
        title: err.name,
        message: err.message,
      });
    }
  }, [currentMode, isCommentable, shareInfoService.shareInfo, t]);

  const stateLabel = isSharedPage
    ? isCommentable
      ? 'Can read & comment'
      : t['com.notesgraph.share-menu.option.link.readonly']()
    : t['com.notesgraph.share-menu.option.link.no-access']();

  return (
    <div className={styles.rowContainerStyle}>
      <div className={styles.labelStyle}>
        {t['com.notesgraph.share-menu.option.link.label']()}
      </div>
      {disabled ? (
        <div className={clsx(styles.menuTriggerStyle, 'disable')}>
          <div className={styles.menuTriggerText}>{stateLabel}</div>
        </div>
      ) : (
        <Menu
          contentOptions={{
            align: 'end',
          }}
          items={
            <>
              <MenuItem
                prefixIcon={<LockIcon />}
                onSelect={onDisablePublic}
                selected={!isSharedPage}
              >
                <div className={styles.publicItemRowStyle}>
                  <div>
                    {t['com.notesgraph.share-menu.option.link.no-access']()}
                  </div>
                </div>
              </MenuItem>
              <MenuItem
                prefixIcon={<ViewIcon />}
                onSelect={onClickAnyoneReadOnlyShare}
                data-testid="share-link-menu-enable-share"
                selected={!!isSharedPage && !isCommentable}
              >
                <div className={styles.publicItemRowStyle}>
                  <div>
                    {t['com.notesgraph.share-menu.option.link.readonly']()}
                  </div>
                </div>
              </MenuItem>
              <MenuItem
                prefixIcon={<CommentIcon />}
                onSelect={onClickAnyoneCommentShare}
                data-testid="share-link-menu-enable-comment-share"
                selected={!!isCommentable}
              >
                <div className={styles.publicItemRowStyle}>
                  <div>Can read &amp; comment</div>
                </div>
              </MenuItem>
            </>
          }
        >
          <MenuTrigger
            className={styles.menuTriggerStyle}
            data-testid="share-link-menu-trigger"
            variant="plain"
            suffixClassName={styles.suffixClassName}
            contentStyle={{
              width: '100%',
            }}
            loading={isRevalidating}
            disabled={isRevalidating}
          >
            {stateLabel}
          </MenuTrigger>
        </Menu>
      )}
    </div>
  );
};
