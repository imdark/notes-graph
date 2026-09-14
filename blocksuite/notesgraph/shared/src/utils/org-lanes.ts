/**
 * Kanban lane roles and the plain-text lane declaration.
 *
 * A board's lane set is mirrored into its doc as an org-style directive
 * line so the workflow itself is visible/editable as text:
 *
 *   #+SEQ_TODO: [ ] [-] BLOCKED(b) | [X]
 *
 * Tokens are the org status annotations of each visible lane, in lane
 * order; lanes after the `|` are terminal (role 'done'). The first active
 * token is the 'start' lane; other actives are 'progress' unless marked
 * `(b)` for blocked.
 */
import { orgStatusLabel, orgStatusText } from './org-status';

export type LaneRole = 'start' | 'progress' | 'blocked' | 'done';

/** Infers a lane's role from its option name when no explicit role is set. */
export function inferLaneRole(optionValue: string): LaneRole {
  const label = orgStatusLabel(orgStatusText(optionValue)).toLowerCase();
  if (label === 'todo') return 'start';
  if (label === 'done') return 'done';
  if (/block|wait|hold|stuck/.test(optionValue.toLowerCase())) return 'blocked';
  return 'progress';
}

export const LANE_ROLES: { role: LaneRole; label: string }[] = [
  { role: 'start', label: 'Start' },
  { role: 'progress', label: 'In Progress' },
  { role: 'blocked', label: 'Blocked' },
  { role: 'done', label: 'Done' },
];

export const LANE_DECLARATION_PREFIX = '#+SEQ_TODO:';

/**
 * Serializes visible lanes (in board order) into the declaration line.
 */
export function formatLaneDeclaration(
  lanes: { value: string; role: LaneRole }[]
): string {
  const active = lanes.filter(lane => lane.role !== 'done');
  const terminal = lanes.filter(lane => lane.role === 'done');
  const token = (lane: { value: string; role: LaneRole }) => {
    const text = orgStatusText(lane.value);
    return lane.role === 'blocked' ? `${text}(b)` : text;
  };
  const parts = [
    active.map(token).join(' '),
    terminal.map(token).join(' '),
  ].filter(part => part.length > 0);
  return `${LANE_DECLARATION_PREFIX} ${parts.join(' | ')}`;
}

/**
 * Parses a declaration line back into ordered lanes with roles. Returns
 * null when the line isn't a lane declaration.
 */
export function parseLaneDeclaration(
  line: string
): { statusText: string; role: LaneRole }[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(LANE_DECLARATION_PREFIX)) return null;
  const body = trimmed.slice(LANE_DECLARATION_PREFIX.length).trim();
  if (!body) return [];
  const [activePart, terminalPart = ''] = body.split('|').map(s => s.trim());
  const tokens = (part: string) =>
    part.length === 0
      ? []
      : (part.match(/\[[^\]]*\](\(b\))?|[A-Z][A-Z_-]*(\(b\))?/g) ?? []);
  const lanes: { statusText: string; role: LaneRole }[] = [];
  tokens(activePart).forEach((token, i) => {
    const blocked = token.endsWith('(b)');
    const statusText = blocked ? token.slice(0, -3) : token;
    lanes.push({
      statusText,
      role: blocked ? 'blocked' : i === 0 ? 'start' : 'progress',
    });
  });
  for (const token of tokens(terminalPart)) {
    const statusText = token.endsWith('(b)') ? token.slice(0, -3) : token;
    lanes.push({ statusText, role: 'done' });
  }
  return lanes;
}
