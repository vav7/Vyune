import { type ComponentProps, splitProps } from "solid-js";
import { type FrostGlassVariant, glassVariantStyles, liquidRefractStyles } from "./glassVariants";
import { LiquidGlass } from "./LiquidGlass";

export type GlassCardProps = ComponentProps<"div"> & {
  glassVariant?: FrostGlassVariant;
  glance?: boolean;
};

export function GlassCard(allProps: GlassCardProps) {
  const [local, rest] = splitProps(allProps, [
    "glassVariant",
    "glance",
    "class",
    "children",
  ]);

  const variant = () => local.glassVariant ?? "frosted";
  const isLiquidRefract = () => variant() === "liquid-refract";

  const computedClass = () =>
    [
      "relative rounded-[var(--r-md,10px)] transition-all duration-300",
      local.glance ? "glance" : "",
      isLiquidRefract() ? liquidRefractStyles : glassVariantStyles[variant()],
      local.class ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  if (isLiquidRefract()) {
    return (
      <LiquidGlass class={computedClass()} {...rest}>
        {local.children}
      </LiquidGlass>
    );
  }

  return (
    <div class={computedClass()} {...rest}>
      {local.children}
    </div>
  );
}
