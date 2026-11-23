/*
 * glassVariants.ts — ported from kostyniuk/glasscn-components (lib/glass-variants.ts)
 * Liquid glass styling variants with high optical clarity, specular rims, and 120 FPS performance.
 */

export type FrostGlassVariant = "clear" | "frosted" | "subtle" | "liquid" | "liquid-refract";
export type FrostGlassVariantProp = { glassVariant?: FrostGlassVariant };

export const liquidRefractStyles = "bg-transparent border-0 shadow-none";

export const glassVariantStyles: Record<FrostGlassVariant, string> = {
  clear: [
    "backdrop-blur-[8px] backdrop-saturate-[1.9]",
    "bg-white/[0.08]",
    "border border-white/[0.18]",
    "shadow-[0_4px_20px_-4px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.3)]",
  ].join(" "),
  frosted: [
    "backdrop-blur-[24px] backdrop-saturate-[1.8]",
    "bg-black/[0.42]",
    "border border-white/[0.12]",
    "shadow-[0_16px_40px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.25)]",
  ].join(" "),
  subtle: [
    "backdrop-blur-[12px] backdrop-saturate-[1.5]",
    "bg-white/[0.04]",
    "border border-white/[0.08]",
    "shadow-[0_2px_10px_rgba(0,0,0,0.25)]",
  ].join(" "),
  liquid: [
    // 1) Refractive backdrop — crystal clear with saturation boost
    "backdrop-blur-[24px] backdrop-saturate-[1.85] backdrop-brightness-[1.05]",

    // 2) Translucent deep fill
    "bg-black/[0.35]",

    // 3) Layered radial-gradient sheen + neutral specular highlight + vertical wash
    "[background-image:radial-gradient(120%_85%_at_15%_8%,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.05)_40%,transparent_70%),radial-gradient(110%_80%_at_85%_100%,rgba(255,255,255,0.10)_0%,transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(0,0,0,0.20)_100%)]",
    "[background-size:200%_200%,180%_180%,100%_100%]",
    "[background-repeat:no-repeat]",

    // 4) Multi-layer bevel with glasscn neutral highlights
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-14px_28px_-10px_rgba(255,255,255,0.12),inset_1px_0_0_0_rgba(255,255,255,0.12),inset_-1px_0_0_0_rgba(255,255,255,0.08),0_28px_70px_-18px_rgba(0,0,0,0.65),0_10px_28px_-10px_rgba(0,0,0,0.45)]",

    // 5) Hairline chamfer outer edge
    "border border-white/[0.14]",
  ].join(" "),
  "liquid-refract": "backdrop-blur-[32px] backdrop-saturate-[2] bg-white/[0.06] border border-white/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),0_24px_60px_-16px_rgba(0,0,0,0.7)]",
};
