/*
 * AppBackground.tsx — the app's fixed background canvas.
 *
 * Design: pure deep dark (#07070b) base with a single, subtle warm ambient
 * radial that picks up the page's artwork tint. No grid patterns, no SVG
 * tech circles, no heavy vignettes, no noise grain. The glass surfaces
 * themselves provide all the visual interest; the background's job is to
 * be deep, clean, and optically recede.
 *
 * The ambient bleed is driven by the same `--amb1`…`--amb4` custom
 * properties that the layout's `.mc-ambient` element already sets from
 * the page's extracted palette — so the background breathes with the music.
 */

export function AppBackground() {
  return (
    <div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* 1. Pure OLED Deep Black Base — zero noise, zero grain, true Apple dark mode */}
      <div
        class="absolute inset-0 bg-[#07070a]"
      />

      {/* 2. Pure ambient mesh glow ONLY from song artwork colors — zero bluish-grey fog */}
      <div
        class="absolute inset-0 opacity-[0.28] transition-opacity duration-[1.5s] ease-out"
        style={{
          background:
            'radial-gradient(ellipse 75% 55% at 20% 12%, var(--amb1, transparent) 0%, transparent 65%), ' +
            'radial-gradient(ellipse 65% 50% at 80% 80%, var(--amb2, transparent) 0%, transparent 60%), ' +
            'radial-gradient(ellipse 45% 35% at 50% 40%, var(--amb3, transparent) 0%, transparent 55%)',
        }}
      />
    </div>
  );
}
