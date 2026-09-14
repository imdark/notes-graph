import type { CustomTheme } from './types';

/**
 * Built-in theme presets for the theming gallery. Each preset recolors the
 * app's accent family (brand / primary / secondary / emphasis / link) per color
 * scheme via the existing custom-theme pipeline — so applying one is a single
 * {@link ThemeEditorService.setCustomTheme} call and reads back through
 * `customTheme$`. Backgrounds/text are left to the base light/dark themes so
 * every preset stays readable.
 */
export interface ThemePreset {
  id: string;
  name: string;
  /** Representative color for the gallery tile. */
  swatch: string;
  theme: CustomTheme;
}

// The accent tokens a preset overrides (kebab of the @toeverything/theme names).
const ACCENT_KEYS = [
  '--notesgraph-brand-color',
  '--notesgraph-primary-color',
  '--notesgraph-secondary-color',
  '--notesgraph-text-emphasis-color',
] as const;

const accent = (color: string, link: string): Record<string, string> => {
  const out: Record<string, string> = { '--notesgraph-link-color': link };
  for (const key of ACCENT_KEYS) out[key] = color;
  return out;
};

/** `[accent, link]` for a scheme. */
type Tone = [accent: string, link: string];

const preset = (
  id: string,
  name: string,
  light: Tone,
  dark: Tone
): ThemePreset => ({
  id,
  name,
  swatch: light[0],
  theme: {
    light: accent(light[0], light[1]),
    dark: accent(dark[0], dark[1]),
  },
});

export const THEME_PRESETS: ThemePreset[] = [
  preset('ocean', 'Ocean', ['#1E96EB', '#1C81D9'], ['#3AB5F7', '#60CFFA']),
  preset('violet', 'Violet', ['#7C3AED', '#6D28D9'], ['#A78BFA', '#C4B5FD']),
  preset('emerald', 'Emerald', ['#059669', '#047857'], ['#34D399', '#6EE7B7']),
  preset('amber', 'Amber', ['#D97706', '#B45309'], ['#FBBF24', '#FCD34D']),
  preset('rose', 'Rose', ['#E11D48', '#BE123C'], ['#FB7185', '#FDA4AF']),
  preset('teal', 'Teal', ['#0D9488', '#0F766E'], ['#2DD4BF', '#5EEAD4']),
  preset('indigo', 'Indigo', ['#4F46E5', '#4338CA'], ['#818CF8', '#A5B4FC']),
  preset('graphite', 'Graphite', ['#475569', '#334155'], ['#94A3B8', '#CBD5E1']),
];

/** The primary-color token used to detect which preset (if any) is active. */
export const PRESET_MATCH_KEY = '--notesgraph-primary-color';
