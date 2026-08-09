import { useTheme } from "./theme-context.ts";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark theme"
      onClick={toggle}
      className="relative h-[26px] w-[46px] flex-none cursor-pointer rounded-full bg-sunken shadow-[inset_0_0_0_1px_var(--line)]"
    >
      <span
        className={`absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-surface shadow-lift transition-transform duration-200 ease-out ${
          dark ? "translate-x-5" : "translate-x-0"
        }`}
      />
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`absolute top-1/2 left-[7px] h-3 w-3 -translate-y-1/2 fill-none stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${
          dark ? "stroke-ink-3" : "stroke-ink"
        }`}
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 1.9v2.3M12 19.8v2.3M1.9 12h2.3M19.8 12h2.3M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`absolute top-1/2 right-[7px] h-3 w-3 -translate-y-1/2 stroke-none ${
          dark ? "fill-ink" : "fill-ink-3"
        }`}
      >
        <path d="M20.3 14.9A8.6 8.6 0 0 1 9.1 3.7a8.6 8.6 0 1 0 11.2 11.2Z" />
      </svg>
    </button>
  );
}
