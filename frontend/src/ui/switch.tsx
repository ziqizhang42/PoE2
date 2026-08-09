/** Keyboard-operable labeled switch whose state is exposed through `aria-checked`. */
export function Switch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2 disabled:cursor-default disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
          checked ? "bg-pen-1" : "bg-sunken shadow-[inset_0_0_0_1px_var(--line)]"
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-surface shadow-lift transition-transform duration-200 ease-out ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      {label}
    </button>
  );
}
