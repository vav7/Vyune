/*
 * GlassButton.tsx — ported from kostyniuk/glasscn-components (components/ui/glasscn/glass-button.tsx)
 * High-performance liquid glass button with glance hover shine and active states.
 */

import { type ComponentProps, splitProps } from "solid-js";
import { type FrostGlassVariant, glassVariantStyles } from "./glassVariants";
import { LiquidGlass } from "./LiquidGlass";

export type GlassButtonVariant = "primary" | "glass" | "tint" | "plain" | "icon";
export type GlassButtonSize = "sm" | "md" | "lg" | "icon";

export type GlassButtonProps = ComponentProps<"button"> & {
  glassVariant?: FrostGlassVariant;
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  pill?: boolean;
  glance?: boolean;
};

export function GlassButton(allProps: GlassButtonProps) {
  const [local, rest] = splitProps(allProps, [
    "glassVariant",
    "variant",
    "size",
    "pill",
    "glance",
    "class",
    "children",
  ]);

  const glassVar = () => local.glassVariant ?? (local.variant === "primary" ? "liquid" : "frosted");
  const size = () => local.size ?? "md";

  const sizeClass = () => {
    switch (size()) {
      case "sm":
        return "h-7 px-3 text-xs gap-1.5";
      case "lg":
        return "h-11 px-5 text-base gap-2.5";
      case "icon":
        return "size-9 p-0 flex items-center justify-center";
      default:
        return "h-9 px-4 text-sm gap-2";
    }
  };

  const isLiquidRefract = () => glassVar() === "liquid-refract";

  const baseClasses = () =>
    [
      "inline-flex items-center justify-center font-medium cursor-pointer transition-all duration-200 select-none outline-none active:scale-[0.96]",
      local.pill ? "rounded-full" : "rounded-xl",
      sizeClass(),
      local.glance !== false ? "glance" : "",
      isLiquidRefract() ? "bg-transparent border-0 shadow-none" : glassVariantStyles[glassVar()],
      local.class ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  if (isLiquidRefract()) {
    return (
      <LiquidGlass class={local.pill ? "rounded-full" : "rounded-xl"}>
        <button
          type="button"
          data-slot="glass-button"
          class={baseClasses()}
          {...rest}
        >
          {local.children}
        </button>
      </LiquidGlass>
    );
  }

  return (
    <button
      type="button"
      data-slot="glass-button"
      class={baseClasses()}
      {...rest}
    >
      {local.children}
    </button>
  );
}
