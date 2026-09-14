import type { BaseTextAttributes, DeltaInsert } from '@blocksuite/store';

import type { InlineEditor } from '../inline-editor.js';
import type { InlineRange } from '../types.js';
import { intersectInlineRange } from '../utils/inline-range.js';

export class InlineTextService<TextAttributes extends BaseTextAttributes> {
  /**
   * Clamp an inline range to the current Y.Text bounds. Some Android IMEs emit
   * a composition range whose length exceeds the (still-empty) model — e.g.
   * `{index:0,length:5}` against a length-0 text — which makes Yjs traverse
   * past the end of the type and throw "Cannot read properties of null
   * (reading 'parent')". A valid range is already within bounds, so this is a
   * no-op for normal edits.
   */
  private _clampRange(inlineRange: InlineRange): InlineRange {
    const max = this.yText.length;
    const index = Math.max(0, Math.min(inlineRange.index, max));
    const length = Math.max(0, Math.min(inlineRange.length, max - index));
    return { index, length };
  }

  deleteText = (inlineRange: InlineRange): void => {
    if (this.editor.isReadonly) return;

    const { index, length } = this._clampRange(inlineRange);
    if (length === 0) return;
    this.transact(() => {
      this.yText.delete(index, length);
    });
  };

  formatText = (
    inlineRange: InlineRange,
    attributes: TextAttributes,
    options: {
      match?: (delta: DeltaInsert, deltaInlineRange: InlineRange) => boolean;
      mode?: 'replace' | 'merge';
      withoutTransact?: boolean;
    } = {}
  ): void => {
    if (this.editor.isReadonly) return;

    const {
      match = () => true,
      mode = 'merge',
      withoutTransact = false,
    } = options;
    const deltas = this.editor.deltaService.getDeltasByInlineRange(inlineRange);

    deltas
      .filter(([delta, deltaInlineRange]) => match(delta, deltaInlineRange))
      .forEach(([_delta, deltaInlineRange]) => {
        const normalizedAttributes =
          this.editor.attributeService.normalizeAttributes(attributes);
        if (!normalizedAttributes) return;

        const targetInlineRange = intersectInlineRange(
          inlineRange,
          deltaInlineRange
        );
        if (!targetInlineRange) return;

        if (mode === 'replace') {
          this.resetText(targetInlineRange);
        }

        this.transact(() => {
          this.yText.format(
            targetInlineRange.index,
            targetInlineRange.length,
            normalizedAttributes
          );
        }, withoutTransact);
      });
  };

  insertLineBreak = (inlineRange: InlineRange): void => {
    if (this.editor.isReadonly) return;

    const { index, length } = this._clampRange(inlineRange);
    this.transact(() => {
      if (length > 0) this.yText.delete(index, length);
      this.yText.insert(index, '\n');
    });
  };

  insertText = (
    inlineRange: InlineRange,
    text: string,
    attributes: TextAttributes = {} as TextAttributes
  ): void => {
    if (this.editor.isReadonly) return;

    if (!text || !text.length) return;

    if (this.editor.attributeService.marks) {
      attributes = { ...attributes, ...this.editor.attributeService.marks };
    }
    const normalizedAttributes =
      this.editor.attributeService.normalizeAttributes(attributes);

    const { index, length } = this._clampRange(inlineRange);
    this.transact(() => {
      if (length > 0) this.yText.delete(index, length);
      this.yText.insert(index, text, normalizedAttributes);
    });
  };

  resetText = (inlineRange: InlineRange): void => {
    if (this.editor.isReadonly) return;

    const coverDeltas: DeltaInsert[] = [];
    for (
      let i = inlineRange.index;
      i <= inlineRange.index + inlineRange.length;
      i++
    ) {
      const delta = this.editor.getDeltaByRangeIndex(i);
      if (delta) {
        coverDeltas.push(delta);
      }
    }

    const unset = Object.fromEntries(
      coverDeltas.flatMap(delta =>
        delta.attributes
          ? Object.keys(delta.attributes).map(key => [key, null])
          : []
      )
    );

    this.transact(() => {
      this.yText.format(inlineRange.index, inlineRange.length, {
        ...unset,
      });
    });
  };

  setText = (
    text: string,
    attributes: TextAttributes = {} as TextAttributes
  ): void => {
    if (this.editor.isReadonly) return;

    this.transact(() => {
      this.yText.delete(0, this.yText.length);
      this.yText.insert(0, text, attributes);
    });
  };

  readonly transact = this.editor.transact;

  get yText() {
    return this.editor.yText;
  }

  constructor(readonly editor: InlineEditor<TextAttributes>) {}
}
