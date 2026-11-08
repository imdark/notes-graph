import { ArrowLeftSmallIcon, CloseIcon } from '@blocksuite/icons/rc';
import {
  IconButton,
  type IconButtonProps,
  useIsInsideModal,
} from '@notesgraph/component';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService, useServiceOptional } from '@notesgraph/infra';
import { type MouseEvent, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

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

  const workbench = useServiceOptional(WorkbenchService)?.workbench;
  const navigate = useNavigate();

  const handleRouteBack = useCallback(() => {
    if (backAction) {
      backAction();
      return;
    }
    // react-router stores the entry index in history.state. At index 0 (cold
    // start on a deep link) history.back() is a silent no-op, so the button
    // looked dead; go home instead. Inside a workspace this has to go through
    // the workbench: `navigate` here is the view's own memory router, which
    // the view never syncs back, so it rendered the view's 404 route ('/' has
    // no match there) while the URL and the view history stayed put.
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (idx === 0) {
      if (workbench) {
        workbench.open('/home', { replaceHistory: true });
      } else {
        navigate('/', { replace: true });
      }
      return;
    }
    history.back();
  }, [backAction, navigate, workbench]);

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
