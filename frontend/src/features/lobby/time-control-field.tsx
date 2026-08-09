import { Button } from "../../ui/button.tsx";
import { HINT } from "../../ui/classes.ts";
import { CHIP_GROUP, ToggleChip } from "../../ui/toggle-chip.tsx";
import { TextField } from "../../ui/text-field.tsx";
import { formatTimeControl } from "../time-control.ts";
import {
  parseTimeControl,
  QUICK_CONTROLS,
  quickFill,
  type TimeControlField as FieldName,
  type TimeControlFields,
} from "./time-control-form.ts";

type TimeControlFieldsetProps = {
  fields: TimeControlFields;
  error: { field: FieldName; message: string } | null;
  disabled: boolean;
  onChange: (fields: TimeControlFields) => void;
};

export function TimeControlFieldset({
  fields,
  error,
  disabled,
  onChange,
}: TimeControlFieldsetProps) {
  const parsed = parseTimeControl(fields);
  const messageFor = (field: FieldName): string | null =>
    error !== null && error.field === field ? error.message : null;

  return (
    <fieldset className="mt-5 border-0 p-0">
      <legend className="mb-2 text-sm font-medium text-ink">How long does each side get?</legend>

      <div className={CHIP_GROUP}>
        <ToggleChip
          type="checkbox"
          name="lobby-untimed"
          label="No clock"
          checked={fields.untimed}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...fields, untimed: event.target.checked });
          }}
        />
      </div>

      {fields.untimed ? (
        <p className={HINT}>
          Neither side is on a clock, so a game only ends when the board fills or someone resigns.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-x-3 [&>div]:mb-3">
            <TextField
              id="time-minutes"
              label="Minutes"
              inputMode="numeric"
              value={fields.minutes}
              disabled={disabled}
              error={messageFor("minutes")}
              onChange={(event) => {
                onChange({ ...fields, minutes: event.target.value });
              }}
            />
            <TextField
              id="time-seconds"
              label="Seconds"
              inputMode="numeric"
              value={fields.seconds}
              disabled={disabled}
              error={messageFor("seconds")}
              onChange={(event) => {
                onChange({ ...fields, seconds: event.target.value });
              }}
            />
            <TextField
              id="time-increment"
              label="Increment (sec)"
              inputMode="numeric"
              value={fields.increment}
              disabled={disabled}
              error={messageFor("increment")}
              onChange={(event) => {
                onChange({ ...fields, increment: event.target.value });
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs text-ink-3">Or start from</span>
            {QUICK_CONTROLS.map((quick) => (
              <Button
                key={quick.label}
                variant="surface"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onChange(quickFill(quick));
                }}
              >
                {quick.label}
              </Button>
            ))}
          </div>

          <p className={HINT}>
            {parsed.ok
              ? `${formatTimeControl(parsed.control)}. The increment is added after every accepted move.`
              : "Fill in a clock both sides can play to."}
          </p>
        </>
      )}
    </fieldset>
  );
}
