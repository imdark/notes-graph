import type { Config } from 'dompurify';
import DOMPurify from 'dompurify';
import { parse } from 'tldts';

type SanitizeSvgOptions = {
  svg?: Config;
  foreignObjectHtml?: Config;
};

const MAX_NESTED_SVG_IMAGE_DEPTH = 2;

const DEFAULT_SVG_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { svg: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['href', 'xlink:href', 'class', 'style', 'id'],
};

const DEFAULT_FOREIGN_OBJECT_HTML_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true },
};

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const SVG_DATA_URL_PATTERN =
  /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?<base64>;base64)?,(?<data>[\s\S]*)$/i;
const SAFE_IMAGE_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i;
const UNSAFE_CSS_KEYWORD_PATTERN =
  /(?:@import|javascript\s*:|expression\s*\(|-moz-binding)/i;
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/**
 * A `url()` is only safe when it references a same-document fragment
 * (e.g. `url(#arrowhead)`). External, protocol, or data URLs can exfiltrate
 * or execute, so any of those makes the surrounding CSS unsafe.
 */
function hasExternalCssUrl(css: string) {
  CSS_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_URL_PATTERN.exec(css)) !== null) {
    if (!match[2].trim().startsWith('#')) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a CSS string (a `<style>` body or a `style=""` attribute) contains
 * anything unsafe to keep in sanitized SVG. Same-document `url(#id)` refs —
 * which mermaid and other renderers rely on for markers/gradients, and which
 * carry theme colors — are kept; everything else that can reach out is not.
 */
export function containsUnsafeCss(css: string) {
  return UNSAFE_CSS_KEYWORD_PATTERN.test(css) || hasExternalCssUrl(css);
}

const SVG_ROOT_ATTRIBUTES = [
  'class',
  'data-height',
  'data-width',
  'height',
  'preserveAspectRatio',
  'viewBox',
  'width',
  'xmlns',
  'xmlns:h5',
  'xmlns:xlink',
];

function getAttribute(element: Element, attribute: string) {
  return (
    element.getAttribute(attribute) ??
    element.getAttribute(attribute.toLowerCase())
  );
}

function getSvgSanitizeConfig(options?: SanitizeSvgOptions) {
  return {
    ...DEFAULT_SVG_SANITIZE_CONFIG,
    ...options?.svg,
  };
}

function getForeignObjectHtmlSanitizeConfig(options?: SanitizeSvgOptions) {
  return {
    ...DEFAULT_FOREIGN_OBJECT_HTML_SANITIZE_CONFIG,
    ...options?.foreignObjectHtml,
  };
}

function isXmlWhitespace(char: string) {
  return (
    char === ' ' ||
    char === '\n' ||
    char === '\r' ||
    char === '\t' ||
    char === '\f'
  );
}

function skipXmlWhitespace(value: string, index: number) {
  while (index < value.length && isXmlWhitespace(value[index])) {
    index++;
  }
  return index;
}

function startsWithIgnoreCase(value: string, search: string, index: number) {
  return value.slice(index, index + search.length).toLowerCase() === search;
}

function getSvgRootStartIndex(value: string) {
  let index = skipXmlWhitespace(value, 0);

  if (startsWithIgnoreCase(value, '<?xml', index)) {
    const declarationEnd = value.indexOf('?>', index + 5);
    if (declarationEnd === -1) return -1;
    index = skipXmlWhitespace(value, declarationEnd + 2);
  }

  if (startsWithIgnoreCase(value, '<!doctype', index)) {
    const doctypeEnd = value.indexOf('>', index + 9);
    if (doctypeEnd === -1) return -1;
    index = skipXmlWhitespace(value, doctypeEnd + 1);
  }

  if (!startsWithIgnoreCase(value, '<svg', index)) return -1;

  const next = value[index + 4];
  return next === '>' || (next !== undefined && isXmlWhitespace(next))
    ? index
    : -1;
}

function hasSvgRoot(value: string) {
  return getSvgRootStartIndex(value) !== -1;
}

function getOriginalSvgRoot(svg: string, parser: DOMParser) {
  const root = parser.parseFromString(svg, 'image/svg+xml').documentElement;
  if (root?.tagName.toLowerCase() === 'svg') {
    return root;
  }
  if (!hasSvgRoot(svg)) {
    return null;
  }
  return parser.parseFromString(svg, 'text/html').querySelector('svg');
}

function ensureSvgRoot(
  originalRoot: Element | null,
  sanitized: string,
  parser: DOMParser
) {
  if (hasSvgRoot(sanitized)) {
    const sanitizedDoc = parser.parseFromString(sanitized, 'image/svg+xml');
    const sanitizedRoot = sanitizedDoc.documentElement;
    return sanitizedRoot?.tagName.toLowerCase() === 'svg'
      ? sanitizedRoot
      : null;
  }

  const svgDoc = parser.parseFromString('<svg></svg>', 'image/svg+xml');
  const svgRoot = svgDoc.documentElement;
  SVG_ROOT_ATTRIBUTES.forEach(attribute => {
    const value = originalRoot ? getAttribute(originalRoot, attribute) : null;
    if (value) {
      svgRoot.setAttribute(attribute, value);
    }
  });
  svgRoot.innerHTML = sanitized;
  return svgRoot;
}

function sanitizeForeignObjects(
  root: ParentNode,
  options?: SanitizeSvgOptions
) {
  root.querySelectorAll('foreignObject, foreignobject').forEach(element => {
    element.innerHTML = DOMPurify.sanitize(
      element.innerHTML,
      getForeignObjectHtmlSanitizeConfig(options)
    );
  });
}

function getSiteDomain(hostname: string) {
  return (
    parse(hostname, { allowPrivateDomains: true }).domain ??
    hostname.toLowerCase()
  );
}

function isSameSiteDomain(url: URL) {
  if (typeof location === 'undefined') return false;
  return getSiteDomain(url.hostname) === getSiteDomain(location.hostname);
}

function isSafeLinkUrl(value: string) {
  try {
    const url = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) && !isSameSiteDomain(url);
  } catch {
    return false;
  }
}

function isSafeHref(element: Element, value: string) {
  if (value.startsWith('#')) return true;
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'use') return false;
  if (tagName === 'image') return SAFE_IMAGE_DATA_URL_PATTERN.test(value);
  if (tagName === 'a') return isSafeLinkUrl(value);
  return false;
}

function decodeSvgDataUrl(value: string) {
  const groups = value.match(SVG_DATA_URL_PATTERN)?.groups;
  if (!groups) return null;

  try {
    if (groups.base64) {
      return new TextDecoder().decode(
        Uint8Array.from(atob(groups.data), char => char.charCodeAt(0))
      );
    }
    return decodeURIComponent(groups.data);
  } catch {
    return null;
  }
}

function encodeSvgDataUrl(svg: string) {
  const binary = Array.from(new TextEncoder().encode(svg), byte =>
    String.fromCharCode(byte)
  ).join('');
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function getHrefAttributes(element: Element) {
  return Array.from(element.attributes).filter(
    attribute => attribute.name === 'href' || attribute.name === 'xlink:href'
  );
}

function tightenSvgTree(
  root: ParentNode,
  options: SanitizeSvgOptions | undefined,
  depth: number
) {
  root.querySelectorAll('*').forEach(element => {
    getHrefAttributes(element).forEach(attribute => {
      const href = attribute.value.trim();
      const nestedSvg =
        element.tagName.toLowerCase() === 'image'
          ? decodeSvgDataUrl(href)
          : null;

      if (nestedSvg !== null) {
        if (depth < MAX_NESTED_SVG_IMAGE_DEPTH) {
          const sanitized = sanitizeSvgWithDepth(nestedSvg, options, depth + 1);
          if (sanitized) {
            element.setAttribute(attribute.name, encodeSvgDataUrl(sanitized));
            return;
          }
        }
        element.remove();
      } else if (!isSafeHref(element, href)) {
        element.removeAttribute(attribute.name);
      }
    });

    const style = element.getAttribute('style');
    if (style && containsUnsafeCss(style)) {
      element.removeAttribute('style');
    }

    if (
      element.tagName.toLowerCase() === 'style' &&
      containsUnsafeCss(element.textContent ?? '')
    ) {
      element.remove();
    }
  });
}

export function sanitizeSvg(svg: string, options?: SanitizeSvgOptions): string {
  return sanitizeSvgWithDepth(svg, options, 0);
}

function sanitizeSvgWithDepth(
  svg: string,
  options: SanitizeSvgOptions | undefined,
  depth: number
): string {
  const svgConfig = getSvgSanitizeConfig(options);

  if (
    typeof DOMParser === 'undefined' ||
    typeof XMLSerializer === 'undefined'
  ) {
    const sanitized = DOMPurify.sanitize(svg, svgConfig);

    if (typeof sanitized !== 'string' || !hasSvgRoot(sanitized)) {
      return '';
    }
    return sanitized.trim();
  }

  const parser = new DOMParser();
  const originalRoot = getOriginalSvgRoot(svg, parser);
  if (!originalRoot) return '';

  const sanitized = DOMPurify.sanitize(svg, svgConfig);
  if (typeof sanitized !== 'string') return '';
  const sanitizedRoot = ensureSvgRoot(originalRoot, sanitized, parser);
  if (!sanitizedRoot) return '';
  sanitizeForeignObjects(sanitizedRoot, options);
  tightenSvgTree(sanitizedRoot, options, depth);
  return new XMLSerializer().serializeToString(sanitizedRoot).trim();
}
