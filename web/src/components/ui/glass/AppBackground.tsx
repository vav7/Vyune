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
      {/* 1. Deep dark base — no image dependency, instant paint */}
      <div
        class="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 120% 90% at 50% 20%, rgba(18, 16, 28, 0.6) 0%, transparent 65%), #07070b',
        }}
      />

      {/* 2. Warm ambient bleed from artwork palette — ultra-soft, GPU-composited */}
      <div
        class="absolute inset-0 opacity-[0.35] transition-opacity duration-[2s] ease-out"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 25% 15%, var(--amb1, rgba(74,70,80,0.3)) 0%, transparent 70%), ' +
            'radial-gradient(ellipse 70% 55% at 75% 85%, var(--amb2, rgba(58,58,66,0.25)) 0%, transparent 65%), ' +
            'radial-gradient(ellipse 50% 40% at 60% 40%, var(--amb3, rgba(85,80,90,0.15)) 0%, transparent 55%)',
        }}
      />

      {/* 3. Feather-light vignette — just enough to frame, never crush */}
      <div
        class="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 85% 75% at 50% 50%, transparent 55%, rgba(0,0,0,0.25) 100%)',
        }}
      />
    </div>
  );
}
