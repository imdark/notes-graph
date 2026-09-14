export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

/**
 * Best-effort: hide the most common cookie/consent/newsletter overlays so
 * screenshots aren't dominated by banners. Curated and conservative.
 */
export const HIDE_OVERLAYS_CSS = `
  #onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter,
  #usercentrics-root, #usercentrics-cmp-ui,
  .fc-consent-root, .fc-dialog-overlay,
  #cookie-banner, #cookieConsent, .cookie-consent, .cookie-banner, .cookies-banner,
  [aria-label="cookieconsent"], .cc-window, .cc-banner,
  div[class*="CookieConsent"], div[id*="cookie-law"],
  .qc-cmp2-container, #sp_message_container_1, .truste_overlay, .truste_box_overlay,
  .modal-backdrop, .newsletter-modal {
    display: none !important;
    visibility: hidden !important;
  }
  html, body { overflow: auto !important; }
`;
