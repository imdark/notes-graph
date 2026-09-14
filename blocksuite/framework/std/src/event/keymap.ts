import { IS_MAC } from '@blocksuite/global/env';
import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import { base, keyName } from 'w3c-keyname';

import type { UIEventHandler } from './base.js';

function normalizeKeyName(name: string) {
  const parts = name.split(/-(?!$)/);
  let result = parts.at(-1);
  if (result === 'Space') {
    result = ' ';
  }
  let alt, ctrl, shift, meta;
  parts.slice(0, -1).forEach(mod => {
    if (/^(cmd|meta|m)$/i.test(mod)) {
      meta = true;
      return;
    }
    if (/^a(lt)?$/i.test(mod)) {
      alt = true;
      return;
    }
    if (/^(c|ctrl|control)$/i.test(mod)) {
      ctrl = true;
      return;
    }
    if (/^s(hift)?$/i.test(mod)) {
      shift = true;
      return;
    }
    if (/^mod$/i.test(mod)) {
      if (IS_MAC) {
        meta = true;
      } else {
        ctrl = true;
      }
      return;
    }

    throw new BlockSuiteError(
      ErrorCode.EventDispatcherError,
      'Unrecognized modifier name: ' + mod
    );
  });
  if (alt) result = 'Alt-' + result;
  if (ctrl) result = 'Ctrl-' + result;
  if (meta) result = 'Meta-' + result;
  if (shift) result = 'Shift-' + result;
  return result as string;
}

function modifiers(name: string, event: KeyboardEvent, shift = true) {
  if (event.altKey) name = 'Alt-' + name;
  if (event.ctrlKey) name = 'Ctrl-' + name;
  if (event.metaKey) name = 'Meta-' + name;
  if (shift && event.shiftKey) name = 'Shift-' + name;
  return name;
}

function normalize(map: Record<string, UIEventHandler>) {
  const copy: Record<string, UIEventHandler> = Object.create(null);
  for (const prop in map) copy[normalizeKeyName(prop)] = map[prop];
  return copy;
}

export function bindKeymap(
  bindings: Record<string, UIEventHandler>
): UIEventHandler {
  const map = normalize(bindings);
  return ctx => {
    const state = ctx.get('keyboardState');
    const event = state.raw;
    const name = keyName(event);
    const direct = map[modifiers(name, event)];
    if (direct && direct(ctx)) {
      return true;
    }
    if (name.length !== 1 || name === ' ') {
      return false;
    }

    if (event.shiftKey) {
      const noShift = map[modifiers(name, event, false)];
      if (noShift && noShift(ctx)) {
        return true;
      }
    }

    // For non-standard keyboards, fallback to keyCode only when modifier keys are pressed.
    // Do NOT fallback when the key produces a non-ASCII character (e.g., Cyrillic 'х' on Russian keyboard),
    // because the user intends to type that character, not trigger a shortcut bound to the physical key.
    // See: https://github.com/notesgraph/notesgraph/issues/14059
    const hasModifier =
      event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
    const baseName = base[event.keyCode];
    const isSingleAscii = name.length === 1 && name.charCodeAt(0) <= 0x7e;
    const isAltInputChar =
      event.altKey && !event.ctrlKey && !event.metaKey && !isSingleAscii;
    // Keep supporting existing Alt+digit shortcuts (e.g. Alt-0/1/2 in edgeless)
    // while preventing Alt-based locale input characters from triggering letter shortcuts.
    const isDigitBaseKey =
      baseName != null && baseName.length === 1 && /[0-9]/.test(baseName);
    if (
      hasModifier &&
      baseName &&
      baseName !== name &&
      !(isAltInputChar && !isDigitBaseKey)
    ) {
      const fromCode = map[modifiers(baseName, event)];
      if (fromCode && fromCode(ctx)) {
        return true;
      }
    }

    return false;
  };
}

// In some IME of Android like, the keypress event  dose not contain
// the information about what key is pressed. See
// https://stackoverflow.com/a/68188679
// https://stackoverflow.com/a/66724830
// Android soft keyboards (GBoard, …) frequently deliver an edit as a
// `beforeinput` with NO usable keydown — the keypress carries no key info. We
// bridge the relevant `inputType`s to their keymap bindings so block-level
// handlers still fire. Without the `insertParagraph → Enter` bridge, Enter at
// the end of a list item fell through to the inline editor and only inserted a
// soft '\n' inside the same block — the intermittent "Enter didn't create a new
// checkbox/list item" bug (it worked only when a synthetic keydown happened to
// arrive). The bound Enter handler preventDefaults the beforeinput, so there's
// no double insertion.
const ANDROID_INPUT_TYPE_TO_KEY: Record<string, string> = {
  deleteContentBackward: 'Backspace',
  insertParagraph: 'Enter',
  insertLineBreak: 'Shift-Enter',
};

export function androidBindKeymapPatch(
  bindings: Record<string, UIEventHandler>
): UIEventHandler {
  return ctx => {
    const event = ctx.get('defaultState').event;
    if (!(event instanceof InputEvent)) return;

    const key = event.inputType
      ? ANDROID_INPUT_TYPE_TO_KEY[event.inputType]
      : undefined;
    if (key && key in bindings) {
      return bindings[key](ctx);
    }

    return false;
  };
}
