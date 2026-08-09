export type ButtonVariant = "primary" | "surface" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-[transform,box-shadow,background-color] duration-150 disabled:pointer-events-none disabled:opacity-55";

const SIZES: Record<ButtonSize, string> = {
  md: "px-4 py-2.5 text-sm",
  sm: "px-3.5 py-2 text-xs",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-pen-1 text-on-fill shadow-lift hover:-translate-y-px hover:bg-pen-1-hover hover:shadow-lift-2 active:translate-y-0",
  surface:
    "bg-surface text-ink shadow-lift hover:-translate-y-px hover:shadow-lift-2 active:translate-y-0",
  quiet: "bg-transparent text-ink-2 hover:bg-sunken hover:text-ink",
  danger: "bg-transparent text-pen-2-text hover:bg-pen-2-soft",
};

export function buttonClassName(variant: ButtonVariant, size: ButtonSize): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}
