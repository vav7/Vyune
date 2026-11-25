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

      {/* 2. Pure ambient mesh glow spreading across sidebar, main stage, and lyrics panel — zero noise, zero fog */}
      <div
        class="absolute inset-0 opacity-[0.45] transition-opacity duration-[1.2s] ease-out pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 75% 65% at 4% 22%, var(--amb1, transparent) 0%, transparent 68%), ' +
            'radial-gradient(ellipse 70% 60% at 94% 72%, var(--amb2, transparent) 0%, transparent 68%), ' +
            'radial-gradient(ellipse 85% 70% at 50% 38%, color-mix(in srgb, var(--amb1, transparent) 60%, var(--amb3, transparent)) 0%, transparent 70%), ' +
            'radial-gradient(circle at 50% 85%, var(--amb4, transparent) 0%, transparent 60%)',
        }}
      />
    </div>
  );
}
