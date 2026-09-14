import type { HTMLAttributes, SVGProps } from 'react';
import { useId } from 'react';

const BRAND_VIOLET = '#7C6CFF';
const BRAND_CYAN = '#22D3EE';

/**
 * NotesGraph brand mark — four nodes wired into an "N", with one accent node
 * carrying the brand gradient (violet → cyan). It reads as a small graph, which
 * is the point: NotesGraph is about the relationships between notes.
 *
 * The structure (edges + three nodes) is drawn in `currentColor` so the mark
 * adapts to whatever context it sits in; only the accent node is fixed to the
 * brand gradient. Drop-in replacement for the old `Logo1Icon`.
 */
export const NotesGraphLogoIcon = (props: SVGProps<SVGSVGElement>) => {
  const gradientId = `ng-accent-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="6"
          y1="6"
          x2="18"
          y2="18"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={BRAND_VIOLET} />
          <stop offset="1" stopColor={BRAND_CYAN} />
        </linearGradient>
      </defs>
      {/* edges: left vertical, diagonal, right vertical — an "N" */}
      <path
        d="M6 18V6M6 6l12 12M18 18V6"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      {/* nodes */}
      <circle cx="6" cy="6" r="2.4" fill="currentColor" />
      <circle cx="6" cy="18" r="2.4" fill="currentColor" />
      <circle cx="18" cy="18" r="2.4" fill="currentColor" />
      <circle cx="18" cy="6" r="3" fill={`url(#${gradientId})`} />
    </svg>
  );
};

/** Wordmark lockup: the brand mark followed by "NotesGraph". */
export const NotesGraphLogo = (props: HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 600,
      }}
      {...props}
    >
      <NotesGraphLogoIcon style={{ fontSize: '1.4em' }} />
      NotesGraph
    </span>
  );
};
