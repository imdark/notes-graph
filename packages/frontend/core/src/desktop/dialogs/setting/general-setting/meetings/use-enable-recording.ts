import { useConfirmModal } from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { MeetingSettingsService } from '@notesgraph/core/modules/media/services/meeting-settings';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import track from '@notesgraph/track';

export const useEnableRecording = () => {
  const meetingSettingsService = useService(MeetingSettingsService);
  const confirmModal = useConfirmModal();
  const t = useI18n();

  const handleEnabledChange = useAsyncCallback(
    async (checked: boolean) => {
      try {
        track.$.settingsPanel.meetings.toggleMeetingFeatureFlag({
          option: checked ? 'on' : 'off',
          type: 'Meeting record',
        });
        await meetingSettingsService.setEnabled(checked);
      } catch {
        confirmModal.openConfirmModal({
          title:
            t[
              'com.notesgraph.settings.meetings.record.permission-modal.title'
            ](),
          description:
            t[
              'com.notesgraph.settings.meetings.record.permission-modal.description'
            ](),
          onConfirm: async () => {
            await meetingSettingsService.showRecordingPermissionSetting(
              'screen'
            );
          },
          cancelText: t['com.notesgraph.recording.dismiss'](),
          confirmButtonOptions: {
            variant: 'primary',
          },
          confirmText:
            t[
              'com.notesgraph.settings.meetings.record.permission-modal.open-setting'
            ](),
        });
      }
    },
    [confirmModal, meetingSettingsService, t]
  );

  return handleEnabledChange;
};
