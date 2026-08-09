import type { ComponentPropsWithoutRef } from "react";

type TextFieldProps = Omit<ComponentPropsWithoutRef<"input">, "className" | "id"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
};

export function TextField({ id, label, hint, error, ...rest }: TextFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const described: string[] = [];
  if (hint !== undefined) {
    described.push(hintId);
  }
  if (error !== undefined && error !== null) {
    described.push(errorId);
  }

  return (
    <div className="mb-4 min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== undefined && error !== null}
        {...(described.length === 0 ? {} : { "aria-describedby": described.join(" ") })}
        className="w-full min-w-0 rounded-md border border-line bg-tile-hi px-3 py-2.5 font-mono text-sm text-ink focus:border-transparent focus:outline-2 focus:outline-pen-1 focus:outline-offset-0"
        {...rest}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="mt-1.5 text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error === undefined || error === null ? null : (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-pen-2-text">
          {error}
        </p>
      )}
    </div>
  );
}
