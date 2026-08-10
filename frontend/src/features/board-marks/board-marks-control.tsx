import { CARD, CARD_TITLE } from "../../ui/classes.ts";
import { Switch } from "../../ui/switch.tsx";
import { useBoardMarks } from "./board-marks-context.ts";

export function BoardMarksControl() {
  const { chosen, setRunValues, setSquareGains } = useBoardMarks();

  return (
    <section className={CARD} aria-labelledby="board-marks-title">
      <h2 id="board-marks-title" className={CARD_TITLE}>
        What the board draws
      </h2>
      <div className="flex flex-col gap-3">
        <Switch label="Run values" checked={chosen.runValues} onChange={setRunValues} />
        <Switch label="Square gains" checked={chosen.squareGains} onChange={setSquareGains} />
      </div>
    </section>
  );
}
