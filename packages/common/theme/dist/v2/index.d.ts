import { darkThemeV2, lightThemeV2, type nestedDarkTheme, type nestedLightTheme } from './variables';
type NestedTheme = typeof nestedLightTheme | typeof nestedDarkTheme;
export { darkThemeV2, lightThemeV2 };
export type NotesGraphThemeV2 = typeof lightThemeV2;
export type NotesGraphThemeKeyV2 = keyof NotesGraphThemeV2;
export declare function themeToVar(theme: NotesGraphThemeKeyV2): string;
export declare const lightCssVariablesV2: Record<string, string>;
export declare const darkCssVariablesV2: Record<string, string>;
declare function _cssVarV2(key: NotesGraphThemeKeyV2, fallback?: string): string;
/**
 * Get NotesGraph css variable name type safely (v2)
 * @param key as copied from Figma design. __e.g. `text/primary`__
 *
 * ```ts
 * import { cssVarV2 } from '@toeverything/theme/v2';
 *
 * cssVarV2('text/primary');
 * cssVarV2('button/siderbarPrimary/background')
 *
 * // alternative syntax:
 * cssVarV2.text.primary;
 * cssVarV2.button.siderbarPrimary.background;
 * ```
 */
export declare const cssVarV2: typeof _cssVarV2 & NestedTheme;
