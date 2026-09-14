import { html } from 'satori-html';

import type { LinkPreview } from './types';

export interface CardData extends LinkPreview {
  heroDataUri?: string;
  iconDataUri?: string;
  accent: string;
  accentText: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A 1200x630 card built from extracted content; Satori turns this HTML/CSS into
 * an SVG with no browser. Built as one plain string passed to `html()` in
 * function-call form (the tagged form escapes interpolations). Dynamic text is
 * pre-escaped; markup fragments are concatenated raw. Satori rules: every
 * multi-child box is display:flex; <img> sizes come from `style` px; column
 * children set flex-shrink:0 so a tall title can't overlap siblings.
 */
export function cardMarkup(data: CardData): ReturnType<typeof html> {
  const hasHero = Boolean(data.heroDataUri);
  const leftWidth = hasHero ? 720 : 1200;
  const initial =
    (data.siteName || data.domain || '?').trim().charAt(0).toUpperCase() || '?';

  const avatar = data.iconDataUri
    ? `<img src="${data.iconDataUri}" style="width:56px;height:56px;border-radius:12px;" />`
    : `<div style="display:flex;width:56px;height:56px;border-radius:12px;background:${data.accent};color:${data.accentText};align-items:center;justify-content:center;font-size:30px;font-weight:700;">${escapeHtml(initial)}</div>`;

  const hero = hasHero
    ? `<img src="${data.heroDataUri}" style="width:480px;height:630px;object-fit:cover;" />`
    : '';

  const markup = `
    <div style="display:flex;flex-direction:column;width:1200px;height:630px;background:#ffffff;font-family:Inter;">
      <div style="display:flex;width:1200px;height:14px;background:${data.accent};"></div>
      <div style="display:flex;flex-direction:row;flex-grow:1;">
        <div style="display:flex;flex-direction:column;width:${leftWidth}px;padding:56px;">
          <div style="display:flex;flex-direction:row;align-items:center;flex-shrink:0;">
            ${avatar}
            <div style="display:flex;margin-left:18px;font-size:28px;color:#64748b;">${escapeHtml(data.siteName)}</div>
          </div>
          <div style="display:flex;flex-shrink:0;margin-top:28px;font-size:42px;font-weight:700;color:#0f172a;line-height:1.16;">${escapeHtml(data.title)}</div>
          <div style="display:flex;flex-shrink:0;margin-top:20px;font-size:24px;color:#475569;line-height:1.4;">${escapeHtml(data.excerpt)}</div>
          <div style="display:flex;flex-grow:1;"></div>
          <div style="display:flex;flex-shrink:0;font-size:24px;font-weight:700;color:#334155;">${escapeHtml(data.domain)}</div>
        </div>
        ${hero}
      </div>
    </div>
  `;

  return html(markup);
}
