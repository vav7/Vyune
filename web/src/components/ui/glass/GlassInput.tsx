import { type ComponentProps, splitProps } from "solid-js";

export type GlassInputProps = ComponentProps<"input"> & {
  pill?: boolean;
};

export function GlassInput(allProps: GlassInputProps) {
  const [local, rest] = splitProps(allProps, ["pill", "class"]);

  const computedClass = () =>
    [
      "w-full h-10 px-4 text-[14px] text-white placeholder-white/40",
      "bg-black/40",
      "backdrop-blur-[24px] backdrop-saturate-[1.9]",
      "border border-white/16",
      "shadow-[inset_0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]",
      "transition-all duration-200 outline-none",
      "focus:border-white/40 focus:bg-black/55 focus:shadow-[0_0_0_2px_rgba(255,255,255,0.2),inset_0_1px_0_rgba(255,255,255,0.5)]",
      local.pill ? "rounded-full" : "rounded-[12px]",
      local.class ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  return <input class={computedClass()} {...rest} />;
}
