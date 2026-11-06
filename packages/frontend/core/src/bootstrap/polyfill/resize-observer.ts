import { ResizeObserver } from '@juggle/resize-observer';

// Only fill the gap. The polyfill re-measures every observed element with
// getComputedStyle on each DOM mutation, which showed up as a steady
// main-thread cost on the phone's home screen (hundreds of observed rows);
// the native implementation is free.
(function polyfillResizeObserver() {
  if (typeof window !== 'undefined' && !window.ResizeObserver) {
    window.ResizeObserver = ResizeObserver;
  }
})();
