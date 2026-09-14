import { OverlayModal } from '@notesgraph/component';
import { useI18n } from '@notesgraph/i18n';

export const StarNotesGraphModal = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) => {
  const t = useI18n();

  return (
    <OverlayModal
      open={open}
      topImage={
        <video
          width={400}
          height={300}
          style={{ objectFit: 'cover' }}
          src={'/static/githubStar.mp4'}
          autoPlay
          loop
        />
      }
      title={t['com.notesgraph.star-notesgraph.title']()}
      onOpenChange={setOpen}
      description={t['com.notesgraph.star-notesgraph.description']()}
      cancelText={t['com.notesgraph.star-notesgraph.cancel']()}
      to={BUILD_CONFIG.githubUrl}
      confirmButtonOptions={{
        variant: 'primary',
      }}
      confirmText={t['com.notesgraph.star-notesgraph.confirm']()}
      external
    />
  );
};
