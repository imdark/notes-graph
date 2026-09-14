/**
 * Maps NotesGraph's server-side prompt names (see `blocksuite/ai/provider/prompt.ts`)
 * to local system instructions, so inline actions (summarize / translate /
 * improve / …) produce sensible results when running on-device — the cloud
 * keeps these templates server-side, so locally we have to supply them.
 *
 * Image / mind-map / slides actions are not supported locally and fall back to
 * the generic assistant prompt.
 */
export const LOCAL_SYSTEM_PROMPT =
  "You are a helpful AI assistant inside NotesGraph, running locally on the user's device. Answer concisely.";

const LOCAL_PROMPT_INSTRUCTIONS: Record<string, string> = {
  'Chat With NotesGraph AI': LOCAL_SYSTEM_PROMPT,
  Summary:
    'Summarize the following content concisely. Output only the summary.',
  'Summary as title':
    'Generate a short, descriptive title for the following content. Output only the title, without quotes.',
  'Generate a caption':
    'Write a brief caption for the following content. Output only the caption.',
  'Summary the webpage': 'Summarize the following webpage content concisely.',
  'Explain this': 'Explain the following content clearly and simply.',
  'Explain this code': 'Explain what the following code does, step by step.',
  'Explain this image':
    'The user attached an image; an on-device description of it is provided below. Explain what the image likely shows in clear, simple terms, and note that the description is approximate.',
  'Translate to':
    'Translate the following content into the requested target language. Preserve meaning and formatting. Output only the translation.',
  'Write an article about this':
    'Write a well-structured article about the following topic.',
  'Write a twitter about this':
    'Write a concise, engaging tweet about the following. Keep it under 280 characters.',
  'Write a poem about this': 'Write a poem about the following.',
  'Write a blog post about this':
    'Write an engaging blog post about the following.',
  'Write outline': 'Create a structured outline for the following topic.',
  'Change tone to':
    'Rewrite the following content in the requested tone. Output only the rewritten text.',
  'Brainstorm ideas about this':
    'Brainstorm a list of ideas about the following.',
  'Improve writing for it':
    'Improve the writing of the following text — clarity, flow, and word choice. Output only the improved text.',
  'Improve grammar for it':
    'Correct the grammar of the following text. Output only the corrected text.',
  'Fix spelling for it':
    'Fix the spelling of the following text. Output only the corrected text.',
  'Find action items from it':
    'Extract a checklist of action items from the following content.',
  'Check code error':
    'Find and explain any errors in the following code, and suggest fixes.',
  'Create headings': 'Add clear section headings to the following content.',
  'Make it longer':
    'Expand the following text with more detail while keeping the meaning. Output only the expanded text.',
  'Make it shorter':
    'Make the following text more concise while keeping the key points. Output only the shortened text.',
  'Continue writing': 'Continue writing naturally from the following text.',
};

/** System instruction for a session, derived from its prompt name. */
export function systemPromptFor(promptName?: string | null): string {
  return (
    (promptName && LOCAL_PROMPT_INSTRUCTIONS[promptName]) || LOCAL_SYSTEM_PROMPT
  );
}
