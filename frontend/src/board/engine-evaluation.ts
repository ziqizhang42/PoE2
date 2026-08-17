import { formatHalfPoints } from "./half-points.ts";

/** Engine scores are always normalized to the blue side (Player 1). */
export function formatEngineEvaluation(evaluationHalfPoints: number): string {
  if (evaluationHalfPoints === 0) {
    return "0";
  }

  const sign = evaluationHalfPoints > 0 ? "+" : "−";
  return `${sign}${formatHalfPoints(evaluationHalfPoints)}`;
}

export function engineEvaluationToneClass(evaluationHalfPoints: number): string {
  return evaluationHalfPoints > 0
    ? "text-pen-1-text"
    : evaluationHalfPoints < 0
      ? "text-pen-2-text"
      : "text-ink";
}

export function engineEvaluationValueText(
  evaluations: readonly (number | null)[],
  currentPly: number,
  finalPly: number,
): string {
  const evaluation = evaluations[currentPly] ?? null;
  const standing =
    evaluation === null ? "engine evaluation not available" : describeEvaluation(evaluation);
  return `Ply ${String(currentPly)} of ${String(finalPly)}, ${standing}`;
}

export function describeEngineEvaluations(
  evaluations: readonly (number | null)[],
  currentPly: number,
  finalPly: number,
): string {
  const count = evaluations.slice(0, finalPly + 1).filter(isEvaluation).length;
  const position = engineEvaluationValueText(evaluations, currentPly, finalPly);
  return `Engine evaluation after each move. ${position}. ${String(count)} of ${String(
    finalPly + 1,
  )} positions analyzed.`;
}

function describeEvaluation(evaluation: number): string {
  if (evaluation === 0) {
    return "engine evaluation 0, an even position";
  }
  const side = evaluation > 0 ? "blue" : "orange";
  return `engine evaluation ${formatEngineEvaluation(evaluation)}, advantage ${side}`;
}

function isEvaluation(value: number | null): value is number {
  return value !== null;
}
