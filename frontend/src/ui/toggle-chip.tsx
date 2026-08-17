import type { ComponentPropsWithoutRef } from "react";

export const CHIP_GROUP = "inline-flex flex-wrap gap-1 rounded-full bg-sunken p-1";

const CHIP =
  "toggle-chip inline-flex cursor-pointer items-center justify-center rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap text-ink-2 transition-[background-color,color,box-shadow] duration-150 hover:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-pen-1 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-55";

type ToggleChipProps = Omit<ComponentPropsWithoutRef<"input">, "className"> & {
  label: string;
};

/** Visually styled radio/checkbox that preserves the native input semantics. */
export function ToggleChip({ label, ...rest }: ToggleChipProps) {
  return (
    <label className={CHIP}>
      <input className="sr-only" {...rest} />
      {label}
    </label>
  );
}
