import type { AgentDraft } from '../stores/agents';
import { COMPILE_AGENT_NAME } from './compile-source';
import { NOTES_HEALTH_TEMPLATE } from './notes-health';
import { CLOUD_DEVICE_KEY, RESEARCH_MODEL } from './remote-runner';

/** A starting point for a new agent: the editor opens pre-filled with it. */
export interface AgentTemplate {
  id: string;
  label: string;
  draft: AgentDraft;
}

export const DEAL_MONITOR_INSTRUCTIONS = [
  'You watch online stores and deal sites for graphics-card deals and report',
  'only the ones that qualify.',
  '',
  'A deal qualifies when it is either:',
  '- a desktop NVIDIA GeForce RTX 5090 graphics card sold on its own, or',
  '- a pre-built desktop PC with an RTX 5090 in it, priced under $4000 USD.',
  'Laptops (RTX 5090 Laptop GPU), RTX 5080 or lower, and "RTX 5090 ready" or',
  'empty-slot systems do not count.',
  '',
  'How to work:',
  '1. Read the note for sites, price limits or past findings the user has',
  '   written down; their notes override these defaults.',
  '2. Search widely: retailers (Best Buy, Newegg, Micro Center, B&H, Amazon,',
  '   Walmart, Costco), pre-built makers (Alienware, HP Omen, Corsair, NZXT,',
  '   Origin, iBuyPower, CyberPowerPC, Skytech, MSI), and deal trackers',
  '   (Slickdeals, r/buildapcsales, r/PrebuiltPCs, HotUKDeals, PCPartPicker).',
  '3. Open each candidate page and check the exact GPU, the total price in USD',
  '   before tax, and that it is in stock. Do not trust a headline or a',
  '   search snippet alone.',
  '4. For each match give the product, price, seller, stock status and the',
  '   link. Skip anything already listed in the note.',
  '5. Write new matches to the note under a dated heading, so they stay as a',
  '   history. If nothing qualifies, say so in one line and add nothing.',
  '6. When there is a new match, ask the user so they are notified, naming the',
  '   price and the link first.',
  '',
  'Never buy anything or enter payment details. Say where you found nothing',
  'or could not load a page rather than guessing.',
].join('\n');

export const DEAL_MONITOR_TEMPLATE: AgentTemplate = {
  id: 'deal-monitor',
  label: 'Deal monitor (RTX 5090)',
  draft: {
    name: 'RTX 5090 deal monitor',
    instructions: DEAL_MONITOR_INSTRUCTIONS,
    kind: 'worker',
    // Research on the server's runner: Claude Code + OmniSeek search and reading.
    harness: 'remote',
    model: RESEARCH_MODEL,
    deviceKey: CLOUD_DEVICE_KEY,
    tools: [],
    targets: ['block', 'doc'],
    output: 'panel',
    maxSteps: 30,
    enabled: true,
  },
};

export const COMPILE_SOURCE_INSTRUCTIONS = [
  'You are started on a source note: an article, PDF or Readwise highlight',
  'the user clipped or imported. Compile it into the rest of their notes, the',
  'way a careful reader files what they read. This is not open-ended',
  'research: work from the source itself (fetch the original if the note is',
  'only an excerpt), not from searching the web for more.',
  '',
  '1. Summary. Read the source. Create one note titled "Summary: <source',
  '   title>" with a few sentences on what it says and why it matters, then',
  '   the key claims as a short list. Link it to the source note with',
  '   link_document (the source as parent).',
  '2. Existing notes. For each concept, person, project or organisation the',
  "   source says something new about, look for the user's own note on it",
  '   with keyword_search and semantic_search, and read what is there. Append',
  '   only facts the note does not have yet, each as one plain line ending in',
  '   a citation: "(from <source title>, <date>)" with the source note linked',
  '   and the original URL when there is one. Add, never rewrite or delete.',
  '3. Conflicts. When the source contradicts something a note already says,',
  '   do not change the old text. Append a line starting "Conflict:" that',
  '   gives both claims and both sources, and list it in your final report.',
  '4. Missing concepts. For a concept the source is substantially about that',
  '   has no note yet, create one titled with the concept: a definition and',
  '   the facts from this source, cited the same way. Link it to the source',
  '   note and to the summary with link_document. Do not make a note for',
  '   every passing mention.',
  '',
  "Keep the user's wording and structure in notes you add to. Do not edit",
  'the source note itself beyond what linking adds. Finish with a short',
  'report: the summary note, the notes you added to, the notes you created,',
  'and any conflicts you flagged.',
].join('\n');

export const COMPILE_SOURCE_TEMPLATE: AgentTemplate = {
  id: 'compile-source',
  label: 'Compile a source into my notes',
  draft: {
    name: COMPILE_AGENT_NAME,
    instructions: COMPILE_SOURCE_INSTRUCTIONS,
    kind: 'worker',
    // The server's runner: Claude Code with NotesGraph's write tools
    // (create_document, update_document, link_document) and a sources folder
    // to fetch a PDF into. No investigation skill: it compiles, not researches.
    harness: 'remote',
    model: RESEARCH_MODEL,
    deviceKey: CLOUD_DEVICE_KEY,
    tools: [],
    skills: [],
    targets: ['doc'],
    output: 'panel',
    maxSteps: 40,
    enabled: true,
  },
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  DEAL_MONITOR_TEMPLATE,
  COMPILE_SOURCE_TEMPLATE,
  NOTES_HEALTH_TEMPLATE,
];
