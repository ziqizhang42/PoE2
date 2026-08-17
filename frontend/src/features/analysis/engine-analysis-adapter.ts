import type { AnalysisError, AnalysisRequest, AnalysisSuccess, Move } from "@poe2/engine-wasm";
import { formatSquare, parseSquare, type Square } from "@poe2/rules";

import type { PositionAnalysisSettings } from "./analysis-settings.ts";
import { searchTimeMs } from "./analysis-settings.ts";
import type { EngineAnalysisReport, EngineCandidateLine } from "./engine-analysis.ts";

export const GAME_ANALYSIS_SETTINGS: PositionAnalysisSettings = {
  candidateCount: 1,
  timePreset: "fast",
};

export function encodeEngineMoves(moves: readonly Square[]): readonly Move[] {
  return moves.map((move) => formatSquare(move) as Move);
}

export function engineAnalysisRequest(
  moves: readonly Move[],
  settings: PositionAnalysisSettings,
): AnalysisRequest {
  return {
    moves,
    searchTimeMs: searchTimeMs(settings),
    multiPv: settings.candidateCount,
  };
}

export function engineAnalysisReport(success: AnalysisSuccess): EngineAnalysisReport {
  const lines = success.lines.map(engineCandidateLine);
  const first = lines[0];
  if (first === undefined) {
    throw new TypeError("The engine returned a successful search without a candidate line.");
  }

  return {
    bestMove: engineSquare(success.bestMove),
    evaluationHalfPoints: success.evaluationHalfPoints,
    completedDepth: success.completedDepth,
    nodes: success.nodes,
    principalVariation: success.principalVariation.map(engineSquare),
    lines: [first, ...lines.slice(1)],
    engineVersion: success.engineVersion,
    apiVersion: success.apiVersion,
  };
}

export function engineAnalysisError(error: AnalysisError): string {
  const message = error.message.trim();
  return message.length > 0 ? message : `The engine rejected the search (${error.code}).`;
}

export function invalidEngineResponse(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? `The engine returned an invalid response: ${error.message}`
    : "The engine returned an invalid response.";
}

function engineCandidateLine(line: AnalysisSuccess["lines"][number]): EngineCandidateLine {
  return {
    rank: line.rank,
    move: engineSquare(line.move),
    equivalentMoves: line.equivalentMoves.map(engineSquare),
    evaluationHalfPoints: line.evaluationHalfPoints,
    principalVariation: line.principalVariation.map(engineSquare),
  };
}

function engineSquare(move: Move): Square {
  const square = parseSquare(move);
  if (square === null) {
    throw new TypeError(`The engine returned an invalid square: ${move}`);
  }
  return square;
}
