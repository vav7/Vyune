/*
 * AppBackground.tsx — Pure OLED neutral black base with subtle artwork ambient glow.
 * Zero noise, zero grain, zero grey-blue tint.
 */

export function AppBackground() {
  return (
    <div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#050505]">
      <div
        class="absolute inset-0 opacity-[0.42] transition-opacity duration-1000 ease-out pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 75% 65% at 4% 22%, var(--amb1, transparent) 0%, transparent 68%), ' +
            'radial-gradient(ellipse 70% 60% at 94% 72%, var(--amb2, transparent) 0%, transparent 68%), ' +
            'radial-gradient(ellipse 85% 70% at 50% 38%, color-mix(in srgb, var(--amb1, transparent) 55%, var(--amb3, transparent)) 0%, transparent 70%)',
        }}
      />
    </div>
  );
}
