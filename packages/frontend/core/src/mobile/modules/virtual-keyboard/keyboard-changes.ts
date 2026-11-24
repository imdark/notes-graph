export type KeyboardChange = { visible: boolean; height: number };

/**
 * Orders keyboard events whose "show" needs an async measurement.
 *
 * If the keyboard hides (or shows again) while a show is still measuring, the
 * late result is dropped. Without this, a quick show→hide on Android emitted
 * `visible: true` after the hide and left the app thinking the keyboard was
 * open, which hid the bottom tab bar until the keyboard was opened and closed
 * again.
 */
export function createKeyboardChanges(emit: (change: KeyboardChange) => void) {
  let latest = 0;
  return {
    show(measure: () => Promise<KeyboardChange>): Promise<void> {
      const id = ++latest;
      return measure().then(change => {
        if (id === latest) emit(change);
      });
    },
    hide() {
      latest++;
      emit({ visible: false, height: 0 });
    },
  };
}
