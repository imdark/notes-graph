import type { ToastOptions } from '@notesgraph/component';
import { toast as basicToast } from '@notesgraph/component';

export const toast = (message: string, options?: ToastOptions) => {
  const modal = document.querySelector<HTMLDivElement>('[role=presentation]');
  if (modal && !(modal instanceof HTMLDivElement)) {
    throw new Error('modal should be div');
  }
  return basicToast(message, {
    portal: modal || document.body,
    ...options,
  });
};

declare global {
  // global Events
  interface WindowEventMap {
    'notesgraph-toast:emit': CustomEvent<{
      message: string;
    }>;
  }
}
