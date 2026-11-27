/*
 * AppBackground.tsx — Neutral dark base with dynamic artwork-derived ambient glow.
 * Colours come strictly from the current poster/track (--amb1..--amb4), never hardcoded blue.
 */

export function AppBackground() {
  return (
    <div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#070708]">
      <div
        class="absolute inset-0 opacity-[0.58] transition-[background] duration-1000 ease-out"
        style={{
          background:
            'radial-gradient(ellipse 80% 72% at 6% 18%, var(--amb1, transparent) 0%, transparent 65%), ' +
            'radial-gradient(ellipse 75% 65% at 92% 78%, var(--amb2, transparent) 0%, transparent 60%), ' +
            'radial-gradient(ellipse 90% 75% at 50% 42%, color-mix(in srgb, var(--amb1, transparent) 55%, var(--amb3, transparent)) 0%, transparent 68%), ' +
            'radial-gradient(ellipse 55% 50% at 78% 15%, var(--amb4, transparent) 0%, transparent 55%)',
        }}
      />
    </div>
  );
}
