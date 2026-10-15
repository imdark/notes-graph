import type { AgentDraft } from '../stores/agents';
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

export const NOTES_HEALTH_CHECK_INSTRUCTIONS = [
  'You check the health of this NotesGraph workspace the way a linter checks',
  'code: find the problems, list them where they can be acted on, and fix',
  'nothing yourself. The output is one report note whose fixes are to-dos.',
  '',
  'Walk the workspace with list_documents (page through all of it). Skip',
  'ai / conversations transcripts, daily notes titled with a bare date, and',
  'earlier "Notes health check" reports. Work from titles and the graph',
  '(get_links, get_backlinks); open a note only when a check needs its text.',
  '',
  'Checks:',
  '1. Orphans: no backlinks and no outgoing links, older than a week. Suggest',
  '   the note it most likely belongs under.',
  '2. Dangling links: a link whose target does not exist. Suggest the nearest',
  '   existing title.',
  '3. Near-duplicates: titles that differ only by case, spacing, punctuation,',
  '   a plural or a prefix like "Summary:", or notes semantic_search ranks very',
  '   close that say the same thing. Say which to keep. Do not merge.',
  '4. Stale facts: in the "Agent memory" note and the notes under it, a fact',
  '   dated "as of" more than six months ago, or an age or plan whose date has',
  '   passed.',
  '5. Contradictions: two notes on the same person or subject stating',
  '   incompatible facts, and any line starting "Conflict:". Quote both.',
  '6. Empty and stub notes: a title and no body, or only a heading.',
  'List at most the 20 worst of each and say how many more there are.',
  '',
  'Create one note titled "Notes health check <YYYY-MM-DD>". Its first line',
  'gives the counts and whether they are better or worse than the previous',
  'report (keyword_search "Notes health check"). Then one section per check,',
  'each finding a task line (- [ ] ...) that links the note, says what is',
  'wrong and ends with the suggested fix; a clean check is one line saying so.',
  'Put findings you are unsure of under a "Maybe" sub-heading. End with a',
  '"Skipped" section: what you did not check and why. Link the report under',
  'the previous report, or under "Agent memory" for the first one, with',
  'link_document.',
  '',
  'Apply no fix: no merge, link or deletion. When the "Agent rules" note names',
  'notes to leave alone or another place for reports, it wins over this.',
  'Finish with the report title and its first line.',
].join('\n');

/**
 * Meant to run weekly: make the agent from this, then "Monitor this block…"
 * → An agent → this agent, every week. Each run's one-line summary lands in
 * that block.
 */
export const NOTES_HEALTH_CHECK_TEMPLATE: AgentTemplate = {
  id: 'notes-health-check',
  label: 'Notes health check (weekly)',
  draft: {
    name: 'Notes health check',
    instructions: NOTES_HEALTH_CHECK_INSTRUCTIONS,
    kind: 'worker',
    // The server's runner, for NotesGraph's MCP read and write tools; no
    // OmniSeek skills, it only reads the workspace.
    harness: 'remote',
    model: RESEARCH_MODEL,
    deviceKey: CLOUD_DEVICE_KEY,
    tools: [],
    skills: [],
    targets: ['block', 'doc'],
    output: 'panel',
    maxSteps: 60,
    enabled: true,
  },
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  DEAL_MONITOR_TEMPLATE,
  NOTES_HEALTH_CHECK_TEMPLATE,
];
