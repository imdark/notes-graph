import { memo } from 'react';

// NotesGraph splash mark: the node-edge "N" glyph on a deep-ink tile, with the
// accent node glowing violet -> cyan.
export default memo(function Logo() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="ng-onboarding-accent"
          x1="38"
          y1="38"
          x2="82"
          y2="82"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7C6CFF" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <radialGradient
          id="ng-onboarding-glow"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(82 38) scale(26)"
        >
          <stop stopColor="#22D3EE" stopOpacity="0.5" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill="#16161F" />
      <circle cx="82" cy="38" r="24" fill="url(#ng-onboarding-glow)" />
      <path
        d="M38 82V38M38 38l44 44M82 82V38"
        stroke="#7C6CFF"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="38" cy="38" r="7" fill="#E7E7F2" />
      <circle cx="38" cy="82" r="7" fill="#E7E7F2" />
      <circle cx="82" cy="82" r="7" fill="#E7E7F2" />
      <circle cx="82" cy="38" r="9" fill="url(#ng-onboarding-accent)" />
    </svg>
  );
});
