import { Button, notify } from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { ThemeEditorService } from '@notesgraph/core/modules/theme-editor';
import {
  PRESET_MATCH_KEY,
  THEME_PRESETS,
} from '@notesgraph/core/modules/theme-editor/presets';
import type { CustomTheme } from '@notesgraph/core/modules/theme-editor/types';
import { useLiveData, useService } from '@notesgraph/infra';
import clsx from 'clsx';
import { useCallback, useMemo } from 'react';

import * as styles from './themes-gallery.css';

/** Reject values that could smuggle CSS/markup into an inline custom property. */
const isSafeValue = (v: string): boolean =>
  v.length <= 64 && !/[;{}<>]|url\(|expression|@import|javascript:/i.test(v);

const cleanTokens = (obj: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (
        typeof v === 'string' &&
        /^--notesgraph(-v2)?-[a-z0-9-]+$/.test(k) &&
        isSafeValue(v)
      ) {
        out[k] = v;
      }
    }
  }
  return out;
};

/** Parse + sanitize an imported theme (bare CustomTheme or {theme} wrapper). */
const sanitizeImportedTheme = (raw: unknown): CustomTheme | null => {
  if (!raw || typeof raw !== 'object') return null;
  const themeObj = (raw as { theme?: unknown }).theme ?? raw;
  if (!themeObj || typeof themeObj !== 'object') return null;
  const light = cleanTokens((themeObj as CustomTheme).light);
  const dark = cleanTokens((themeObj as CustomTheme).dark);
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) {
    return null;
  }
  return { light, dark };
};

/**
 * The theme marketplace: a gallery of built-in preset themes the user can apply
 * in one click (via the existing custom-theme pipeline), plus export/import of a
 * theme as JSON so themes can be shared and installed.
 */
export const ThemesGallery = () => {
  const themeEditor = useService(ThemeEditorService);
  const current = useLiveData(themeEditor.customTheme$);
  const modified = useLiveData(themeEditor.modified$);

  const activeId = useMemo(() => {
    if (!modified) return 'default';
    const primary = current?.light?.[PRESET_MATCH_KEY];
    const match = THEME_PRESETS.find(
      p => p.theme.light[PRESET_MATCH_KEY] === primary
    );
    return match?.id ?? 'custom';
  }, [current, modified]);

  const onExport = useCallback(() => {
    const payload = {
      name: 'NotesGraph theme',
      version: 1,
      theme: current ?? { light: {}, dark: {} },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notesgraph-theme.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [current]);

  const onImport = useAsyncCallback(async () => {
    const file = await new Promise<File | null>(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
    if (!file) return;
    try {
      const parsed = sanitizeImportedTheme(JSON.parse(await file.text()));
      if (!parsed) {
        notify.error({
          title: 'Invalid theme file',
          message: 'No valid NotesGraph theme tokens were found.',
        });
        return;
      }
      themeEditor.setCustomTheme(parsed);
      notify.success({ title: 'Theme imported' });
    } catch {
      notify.error({
        title: 'Invalid theme file',
        message: "Couldn't read that file as a theme.",
      });
    }
  }, [themeEditor]);

  return (
    <div className={styles.section} data-testid="themes-gallery">
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Theme presets</div>
          <div className={styles.desc}>
            Apply a color theme in one click, or import one shared with you.
          </div>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" size="default" onClick={onImport}>
            Import…
          </Button>
          <Button
            variant="secondary"
            size="default"
            onClick={onExport}
            disabled={!modified}
          >
            Export
          </Button>
        </div>
      </div>

      <div className={styles.grid}>
        <button
          type="button"
          className={clsx(styles.tile, {
            [styles.tileActive]: activeId === 'default',
          })}
          data-testid="theme-preset"
          data-preset="default"
          onClick={() => themeEditor.reset()}
        >
          <span
            className={clsx(styles.swatch, styles.defaultSwatch)}
            aria-hidden
          />
          <span className={styles.tileName}>Default</span>
        </button>

        {THEME_PRESETS.map(preset => (
          <button
            key={preset.id}
            type="button"
            className={clsx(styles.tile, {
              [styles.tileActive]: activeId === preset.id,
            })}
            data-testid="theme-preset"
            data-preset={preset.id}
            onClick={() => themeEditor.setCustomTheme(preset.theme)}
          >
            <span
              className={styles.swatch}
              style={{ background: preset.swatch }}
              aria-hidden
            />
            <span className={styles.tileName}>{preset.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
