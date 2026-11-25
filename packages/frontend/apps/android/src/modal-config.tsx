import { ModalConfigContext } from '@notesgraph/component';
import { sheetKeyboardOffset } from '@notesgraph/core/mobile/styles/variables.css';

// The WebView doesn't shrink for the keyboard, so a bottom sheet is lifted by
// the keyboard's height to keep its text boxes above it.
const modalConfig = { dynamicKeyboardHeight: sheetKeyboardOffset };

export const ModalConfigProvider = ({ children }: React.PropsWithChildren) => (
  <ModalConfigContext.Provider value={modalConfig}>
    {children}
  </ModalConfigContext.Provider>
);
