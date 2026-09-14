import type { SetStateAction } from 'jotai';
import { atom, useAtom } from 'jotai';

import type { NotesGraphEditorContainer } from '../../blocksuite/block-suite-editor';

const activeEditorContainerAtom = atom<NotesGraphEditorContainer | null>(null);

export function useActiveBlocksuiteEditor(): [
  NotesGraphEditorContainer | null,
  React.Dispatch<SetStateAction<NotesGraphEditorContainer | null>>,
] {
  const [editorContainer, setEditorContainer] = useAtom(
    activeEditorContainerAtom
  );

  return [editorContainer, setEditorContainer];
}
