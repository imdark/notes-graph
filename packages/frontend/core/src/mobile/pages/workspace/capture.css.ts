import { fallbackVar, style } from '@vanilla-extract/css';

import { globalVars } from '../../styles/variables.css';

// The Android WebView doesn't shrink for the keyboard, so the capture keeps
// clear of it here. Otherwise the text box sits under the keyboard.
export const body = style({
  flex: 1,
  minHeight: 0,
  paddingBottom: fallbackVar(globalVars.appKeyboardHeight, '0px'),
});
