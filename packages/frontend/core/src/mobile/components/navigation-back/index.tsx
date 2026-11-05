import { ArrowLeftSmallIcon, CloseIcon } from '@blocksuite/icons/rc';
import {
  IconButton,
  type IconButtonProps,
  useIsInsideModal,
} from '@notesgraph/component';
import { useService } from '@notesgraph/infra';
import { type MouseEvent, useCallback, useEffect, useMemo } from 'react';

import { NavigationGestureService } from '../../modules/navigation-gesture';

export interface NavigationBackButtonProps extends IconButtonProps {
  backAction?: () => void;
}

/**
 * A button to control the back behavior of the mobile app, as well as manage navigation gesture
 */
export const NavigationBackButton = ({
  icon,
  backAction,
  children,
  style: propsStyle,
  ...otherProps
}: NavigationBackButtonProps) => {
  const navigationGesture = useService(NavigationGestureService);
  const isInsideModal = useIsInsideModal();

  const handleRouteBack = useCallback(() => {
    backAction ? backAction() : history.back();
  }, [backAction]);

  // Keep the editor focused on press. Otherwise the press blurs it, the
  // virtual keyboard collapses and the header shifts before the click lands,
  // so the first taps are swallowed.
  const keepEditorFocus = useCallback((e: MouseEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (isInsideModal) return;

    const prev = navigationGesture.enabled$.value;
    navigationGesture.setEnabled(true);

    return () => {
      navigationGesture.setEnabled(prev);
    };
  }, [isInsideModal, navigationGesture]);

  const style = useMemo(() => ({ padding: 10, ...propsStyle }), [propsStyle]);

  if (children) return children;

  return (
    <IconButton
      size={24}
      style={style}
      onMouseDown={keepEditorFocus}
      onClick={handleRouteBack}
      icon={icon ?? (isInsideModal ? <CloseIcon /> : <ArrowLeftSmallIcon />)}
      data-testid="page-header-back"
      {...otherProps}
    />
  );
};
