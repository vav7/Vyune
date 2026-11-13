import { createUniqueId } from 'solid-js';

/** Chrome ribbon V inspired by the VYUNE mark supplied for the brand. */
export function LogoMark(props: { size?: number; class?: string }) {
  const size = () => props.size ?? 24;
  const gradientId = `vyune-metal-${createUniqueId().replace(/:/g, '')}`;

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 68 64"
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={{ display: 'inline-block', 'vertical-align': 'middle', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="10" x2="60" y2="52" gradientUnits="userSpaceOnUse">
          <stop stop-color="#777985" />
          <stop offset=".2" stop-color="#f5f5f7" />
          <stop offset=".38" stop-color="#a5a6ad" />
          <stop offset=".52" stop-color="#fff" />
          <stop offset=".72" stop-color="#777982" />
          <stop offset="1" stop-color="#d9d9dd" />
        </linearGradient>
        <filter id={`${gradientId}-shadow`} x="-20%" y="-20%" width="140%" height="150%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      <g transform="translate(0 1) scale(1 1.05)">
        <path d="M5 8h13c8 0 12 3.6 16 12l10 21 10-21c4-8.4 8-12 16-12H58c-4 0-6.2 2.2-9 8l-5 10-5-10c-2.8-5.8-5-8-9-8H5z" fill="#fff" opacity=".24" filter={`url(#${gradientId}-shadow)`} />
        <path d="M5 7h13c8 0 12 3.6 16 12l10 21 10-21c4-8.4 8-12 16-12H58c-4 0-6.2 2.2-9 8l-5 10-5-10c-2.8-5.8-5-8-9-8H5z" fill={`url(#${gradientId})`} />
        <path d="M5 7h13c8 0 12 3.6 16 12l10 21 10-21c4-8.4 8-12 16-12H58c-4 0-6.2 2.2-9 8l-5 10-5-10c-2.8-5.8-5-8-9-8H5z" fill="#fff" opacity=".86" class="vyune-logo-shine" />
        <path d="m29 17 8 17-4 8-12-24c2.8 0 5.3-.4 8 1Z" fill="#141419" opacity=".78" />
      </g>
    </svg>
  );
}
