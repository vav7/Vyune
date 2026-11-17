import { type ComponentProps, splitProps } from "solid-js";
import { type FrostGlassVariant, glassVariantStyles } from "./glassVariants";

export type GlassBadgeProps = ComponentProps<"span"> & {
  glassVariant?: FrostGlassVariant;
};

export function GlassBadge(allProps: GlassBadgeProps) {
  const [local, rest] = splitProps(allProps, ["glassVariant", "class", "children"]);

  const variant = () => local.glassVariant ?? "clear";

  const computedClass = () =>
    [
      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase text-white/90",
      glassVariantStyles[variant()],
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_8px_rgba(0,0,0,0.35)]",
      local.class ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <span class={computedClass()} {...rest}>
      {local.children}
    </span>
  );
}
