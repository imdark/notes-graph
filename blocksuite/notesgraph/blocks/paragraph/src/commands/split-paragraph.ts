import { ParagraphBlockModel } from '@blocksuite/notesgraph-model';
import {
  focusTextModel,
  getInlineEditorByModel,
} from '@blocksuite/notesgraph-rich-text';
import {
  matchModels,
  orgStampAwareSplitIndex,
} from '@blocksuite/notesgraph-shared/utils';
import { type Command, TextSelection } from '@blocksuite/std';

export const splitParagraphCommand: Command<
  {
    blockId?: string;
  },
  {
    paragraphConvertedId: string;
  }
> = (ctx, next) => {
  const { std } = ctx;
  const { store, selection } = std;
  let blockId = ctx.blockId;
  if (!blockId) {
    const text = selection.find(TextSelection);
    blockId = text?.blockId;
  }
  if (!blockId) return;

  const model = store.getBlock(blockId)?.model;
  if (!model || !matchModels(model, [ParagraphBlockModel])) return;

  const inlineEditor = getInlineEditorByModel(std, model);
  const range = inlineEditor?.getInlineRange();
  if (!range) return;

  const splitIndex = range.index;
  const splitLength = range.length;
  // On press enter, it may convert symbols from yjs ContentString
  // to yjs ContentFormat. Once it happens, the converted symbol will
  // be deleted and not counted as model.text.yText.length.
  // Example: "`a`[enter]" -> yText[<ContentFormat: Code>, "a", <ContentFormat: Code>]
  // In this case, we should not split the block.
  if (model.props.text.yText.length < splitIndex + splitLength) return;

  // Keep a trailing org planning stamp (CLOSED/STARTED chip) on this block when
  // pressing Enter at the end: with a collapsed caret past the real text, split
  // at the true end so the badge stays put and the new block starts blank.
  const effectiveIndex =
    splitLength === 0
      ? orgStampAwareSplitIndex(model.props.text.toDelta(), splitIndex)
      : splitIndex;

  if (model.children.length > 0 && splitIndex > 0) {
    store.captureSync();
    const right = model.props.text.split(effectiveIndex, splitLength);
    const id = store.addBlock(
      model.flavour,
      {
        text: right,
        type: model.props.type,
      },
      model,
      0
    );
    focusTextModel(std, id);
    return next({ paragraphConvertedId: id });
  }

  const parent = store.getParent(model);
  if (!parent) return;
  const index = parent.children.indexOf(model);
  if (index < 0) return;
  store.captureSync();
  const right = model.props.text.split(effectiveIndex, splitLength);
  const id = store.addBlock(
    model.flavour,
    {
      text: right,
      type: model.props.type,
    },
    parent,
    index + 1
  );
  const newModel = store.getBlock(id)?.model;
  if (newModel) {
    store.moveBlocks(model.children, newModel);
  } else {
    console.error('Failed to find the new model split from the paragraph');
  }
  focusTextModel(std, id);
  return next({ paragraphConvertedId: id });
};
