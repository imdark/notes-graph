import { createVar, fallbackVar } from '@vanilla-extract/css';

export const globalVars = {
  /**
   * The height of the keyboard, it will update when the keyboard is open or closed
   */
  appKeyboardHeight: createVar('appKeyboardHeight'),
  /**
   * The height of the keyboard, it will not update when the keyboard is open or closed
   * for dynamic height, use appKeyboardHeight instead
   */
  appKeyboardStaticHeight: createVar('appKeyboardStaticHeight'),
  appTabHeight: createVar('appTabHeight'),
  appTabSafeArea: createVar('appTabSafeArea'),
};

/**
 * How far a bottom sheet sits off the bottom where the WebView doesn't shrink
 * for the keyboard (Android): above the keyboard while it is open, 12px
 * otherwise.
 */
export const sheetKeyboardOffset = `max(12px, ${fallbackVar(globalVars.appKeyboardHeight, '0px')})`;
