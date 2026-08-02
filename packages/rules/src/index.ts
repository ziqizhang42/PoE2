export {
  allSquares,
  BOARD_SIZE,
  cellAt,
  CELL_COUNT,
  createEmptyBoard,
  EMPTY,
  emptyCount,
  isBoardFull,
  isEmptySquare,
  isValidSquare,
  opponent,
  pieceCount,
  PLAYER_ONE,
  PLAYER_TWO,
  squareFromIndex,
  squareIndex,
} from "./board.js";
export type { Board, Cell, Player, Square } from "./board.js";

export { formatSquare, MOVE_ERRORS, parseSquare, validateMove } from "./move.js";
export type { MoveError } from "./move.js";

export {
  leaderAfterHandicap,
  lineScore,
  marginHalfPoints,
  MAX_LINE_LENGTH,
  playerBreakdown,
  PLAYER_TWO_HANDICAP_HALF_POINTS,
  resultIfFull,
  scoreBoard,
  scoreBreakdown,
  scorePlayer,
} from "./score.js";
export type {
  GameResult,
  PlayerScore,
  Run,
  RunDirection,
  ScoreBreakdown,
  ScoreByPlayer,
} from "./score.js";

export {
  applyMove,
  createGame,
  gameResult,
  isGameOver,
  legalMoves,
  ply,
  replay,
  sideToMove,
} from "./game.js";
export type { Game, MoveResult, ReplayResult } from "./game.js";
