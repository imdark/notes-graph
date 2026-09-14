import { ModalConfigContext } from '@notesgraph/component';
import { NavigationGestureService } from '@notesgraph/core/mobile/modules/navigation-gesture';
import { globalVars } from '@notesgraph/core/mobile/styles/variables.css';
import { useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

export const ModalConfigProvider = ({ children }: React.PropsWithChildren) => {
  const navigationGesture = useService(NavigationGestureService);

  const onOpen = useCallback(() => {
    const prev = navigationGesture.enabled$.value;
    if (prev) {
      navigationGesture.setEnabled(false);
      return () => {
        navigationGesture.setEnabled(prev);
      };
    }
    return;
  }, [navigationGesture]);
  const modalConfigValue = useMemo(
    () => ({ onOpen, dynamicKeyboardHeight: globalVars.appKeyboardHeight }),
    [onOpen]
  );

  return (
    <ModalConfigContext.Provider value={modalConfigValue}>
      {children}
    </ModalConfigContext.Provider>
  );
};
