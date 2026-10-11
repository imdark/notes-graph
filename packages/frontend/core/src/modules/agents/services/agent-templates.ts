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

export const AGENT_TEMPLATES: AgentTemplate[] = [DEAL_MONITOR_TEMPLATE];
