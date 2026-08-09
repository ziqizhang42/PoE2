import {
  BOARD_SIZE,
  CELL_COUNT,
  EMPTY,
  PLAYER_ONE,
  PLAYER_TWO,
  type Board,
  type Cell,
  type GameResult,
  type Player,
  type ScoreByPlayer,
  type Square,
} from "@poe2/rules";
import { z } from "zod";

import { AuthUserSchema, type AuthUser } from "./auth.js";

export type GameStatus = "waiting" | "ready_check" | "active" | "finished";

export const GAME_STATUSES: readonly GameStatus[] = [
  "waiting",
  "ready_check",
  "active",
  "finished",
];

/** Shared lifecycle duration so clients and servers describe the same ready window. */
export const READY_CHECK_MS = 60_000;

/** Only board_full derives its winner from the final score. */
export type GameOutcomeReason = "board_full" | "resignation" | "timeout";

export const GAME_OUTCOME_REASONS: readonly GameOutcomeReason[] = [
  "board_full",
  "resignation",
  "timeout",
];

/** Shared creation bounds; frozen SQL repeats them and integration tests compare them. */
export const MIN_INITIAL_MS = 10_000;
export const MAX_INITIAL_MS = 10_800_000;
export const MIN_INCREMENT_MS = 0;
export const MAX_INCREMENT_MS = 180_000;

/** Clocks display whole seconds, so controls use the same precision. */
export const TIME_CONTROL_STEP_MS = 1_000;

export interface UntimedTimeControl {
  readonly kind: "untimed";
  readonly initialMs: null;
  readonly incrementMs: null;
}

export interface TimedTimeControl {
  readonly kind: "timed";
  readonly initialMs: number;
  readonly incrementMs: number;
}

export type TimeControl = UntimedTimeControl | TimedTimeControl;

export const UNTIMED: UntimedTimeControl = {
  kind: "untimed",
  initialMs: null,
  incrementMs: null,
};

export function timedControl(initialMs: number, incrementMs: number): TimedTimeControl | null {
  const parsed = timedTimeControlSchema.safeParse({ kind: "timed", initialMs, incrementMs });
  return parsed.success ? parsed.data : null;
}

/** Both-ready is not representable: the second confirmation activates the game. */
export interface ReadyCheck {
  /** Stable for one check and incremented before the same lobby can reopen it. */
  readonly generation: number;
  readonly playerOneReady: boolean;
  readonly playerTwoReady: boolean;
  readonly deadline: string;
  readonly serverNow: string;
}

export interface RemainingClockTime {
  readonly playerOne: number;
  readonly playerTwo: number;
}

export interface ActiveGameClock {
  readonly remainingMs: RemainingClockTime;
  readonly runningPlayer: Player;
  readonly turnStartedAt: string;
  readonly deadline: string;
  readonly serverNow: string;
}

export interface FinishedGameClock {
  readonly remainingMs: RemainingClockTime;
  readonly stoppedAt: string;
}

/** Recorded outcome; scores and margins remain derived from moves. */
export interface GameOutcome {
  readonly reason: GameOutcomeReason;
  readonly winner: Player;
  readonly finishedAt: string;
}

export interface LobbyEntry {
  readonly id: string;
  /** The creator, not necessarily the eventual Player 1. */
  readonly owner: AuthUser;
  readonly creatorSeat: Player;
  readonly rated: boolean;
  readonly timeControl: TimeControl;
  readonly createdAt: string;
}

interface GameSnapshotFields {
  readonly id: string;
  /** Optimistic-concurrency token for position-dependent commands. */
  readonly revision: number;
  readonly rated: boolean;
  readonly timeControl: TimeControl;
  readonly board: Board;
  readonly moves: readonly Square[];
  /** Raw scores before Player 2's handicap. */
  readonly scores: ScoreByPlayer;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WaitingGameSnapshot extends GameSnapshotFields {
  readonly status: "waiting";
  /** The sole occupant is stored as playerOne until seats are settled. */
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: null };
  readonly creatorSeat: Player;
  readonly sideToMove: null;
  readonly outcome: null;
  readonly clock: null;
  readonly readyCheck: null;
}

/** Both seats are occupied, but play and clocks have not started. */
export interface ReadyCheckGameSnapshot extends GameSnapshotFields {
  readonly status: "ready_check";
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: AuthUser };
  readonly sideToMove: null;
  readonly outcome: null;
  readonly clock: null;
  readonly readyCheck: ReadyCheck;
}

export interface ActiveGameSnapshot extends GameSnapshotFields {
  readonly status: "active";
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: AuthUser };
  readonly sideToMove: Player;
  readonly outcome: null;
  readonly clock: ActiveGameClock | null;
  readonly readyCheck: null;
}

export interface FinishedGameSnapshot extends GameSnapshotFields {
  readonly status: "finished";
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: AuthUser };
  readonly sideToMove: null;
  readonly outcome: GameOutcome;
  readonly clock: FinishedGameClock | null;
  readonly readyCheck: null;
}

export type GameSnapshot =
  | WaitingGameSnapshot
  | ReadyCheckGameSnapshot
  | ActiveGameSnapshot
  | FinishedGameSnapshot;

const cellSchema = z.union([z.literal(EMPTY), z.literal(PLAYER_ONE), z.literal(PLAYER_TWO)]);
const playerSchema = z.union([z.literal(PLAYER_ONE), z.literal(PLAYER_TWO)]);

const squareSchema = z.strictObject({
  row: z
    .int()
    .min(0)
    .max(BOARD_SIZE - 1),
  col: z
    .int()
    .min(0)
    .max(BOARD_SIZE - 1),
});

const scoreByPlayerSchema = z.strictObject({
  playerOne: z.int().min(0),
  playerTwo: z.int().min(0),
});

const gameResultSchema = z.strictObject({
  scores: scoreByPlayerSchema,
  winner: playerSchema,
  // The half-point handicap makes a point-decided draw impossible.
  marginHalfPoints: z.int(),
});

const outcomeReasonSchema = z.enum(["board_full", "resignation", "timeout"]);

const wholeSeconds = (value: number): boolean => value % TIME_CONTROL_STEP_MS === 0;

const untimedTimeControlSchema = z.strictObject({
  kind: z.literal("untimed"),
  initialMs: z.null(),
  incrementMs: z.null(),
});

const timedTimeControlSchema = z.strictObject({
  kind: z.literal("timed"),
  initialMs: z.int().min(MIN_INITIAL_MS).max(MAX_INITIAL_MS).refine(wholeSeconds, {
    message: "Initial time must be a whole number of seconds",
  }),
  incrementMs: z.int().min(MIN_INCREMENT_MS).max(MAX_INCREMENT_MS).refine(wholeSeconds, {
    message: "Increment must be a whole number of seconds",
  }),
});

const timeControlSchema = z.discriminatedUnion("kind", [
  untimedTimeControlSchema,
  timedTimeControlSchema,
]);

const readyCheckSchema = z.strictObject({
  generation: z.int().min(1),
  playerOneReady: z.boolean(),
  playerTwoReady: z.boolean(),
  deadline: z.iso.datetime(),
  serverNow: z.iso.datetime(),
});

const remainingClockTimeSchema = z.strictObject({
  playerOne: z.int().min(0),
  playerTwo: z.int().min(0),
});

const activeGameClockSchema = z.strictObject({
  remainingMs: remainingClockTimeSchema,
  runningPlayer: playerSchema,
  turnStartedAt: z.iso.datetime(),
  deadline: z.iso.datetime(),
  serverNow: z.iso.datetime(),
});

const finishedGameClockSchema = z.strictObject({
  remainingMs: remainingClockTimeSchema,
  stoppedAt: z.iso.datetime(),
});

const gameOutcomeSchema = z.strictObject({
  reason: outcomeReasonSchema,
  winner: playerSchema,
  finishedAt: z.iso.datetime(),
});

const pairedPlayersSchema = z.strictObject({
  playerOne: AuthUserSchema,
  playerTwo: AuthUserSchema,
});

const snapshotFields = {
  id: z.uuid(),
  revision: z.int().min(0),
  rated: z.boolean(),
  timeControl: timeControlSchema,
  board: z.array(cellSchema).length(CELL_COUNT),
  moves: z.array(squareSchema).max(CELL_COUNT),
  scores: scoreByPlayerSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

const waitingGameSnapshotSchema = z.strictObject({
  ...snapshotFields,
  status: z.literal("waiting"),
  players: z.strictObject({ playerOne: AuthUserSchema, playerTwo: z.null() }),
  creatorSeat: playerSchema,
  moves: z.array(squareSchema).max(0),
  sideToMove: z.null(),
  outcome: z.null(),
  clock: z.null(),
  readyCheck: z.null(),
});

const readyCheckGameSnapshotSchema = z.strictObject({
  ...snapshotFields,
  status: z.literal("ready_check"),
  players: pairedPlayersSchema,
  moves: z.array(squareSchema).max(0),
  sideToMove: z.null(),
  outcome: z.null(),
  clock: z.null(),
  readyCheck: readyCheckSchema,
});

const activeGameSnapshotSchema = z.strictObject({
  ...snapshotFields,
  status: z.literal("active"),
  players: pairedPlayersSchema,
  sideToMove: playerSchema,
  outcome: z.null(),
  clock: z.union([activeGameClockSchema, z.null()]),
  readyCheck: z.null(),
});

const finishedGameSnapshotSchema = z.strictObject({
  ...snapshotFields,
  status: z.literal("finished"),
  players: pairedPlayersSchema,
  sideToMove: z.null(),
  outcome: gameOutcomeSchema,
  clock: z.union([finishedGameClockSchema, z.null()]),
  readyCheck: z.null(),
});

export const CellSchema: z.ZodType<Cell> = cellSchema;
export const PlayerSchema: z.ZodType<Player> = playerSchema;
export const SquareSchema: z.ZodType<Square> = squareSchema;

/** Exactly `CELL_COUNT` cells in rules-owned row-major order. */
export const BoardSchema: z.ZodType<Board> = snapshotFields.board;

export const ScoreByPlayerSchema: z.ZodType<ScoreByPlayer> = scoreByPlayerSchema;
export const GameResultSchema: z.ZodType<GameResult> = gameResultSchema;
export const GameOutcomeReasonSchema: z.ZodType<GameOutcomeReason> = outcomeReasonSchema;
export const GameOutcomeSchema: z.ZodType<GameOutcome> = gameOutcomeSchema;
export const TimeControlSchema: z.ZodType<TimeControl> = timeControlSchema;
export const TimedTimeControlSchema: z.ZodType<TimedTimeControl> = timedTimeControlSchema;
export const ReadyCheckSchema: z.ZodType<ReadyCheck> = readyCheckSchema;
export const RemainingClockTimeSchema: z.ZodType<RemainingClockTime> = remainingClockTimeSchema;
export const ActiveGameClockSchema: z.ZodType<ActiveGameClock> = activeGameClockSchema;
export const FinishedGameClockSchema: z.ZodType<FinishedGameClock> = finishedGameClockSchema;

export const LobbyEntrySchema: z.ZodType<LobbyEntry> = z.strictObject({
  id: z.uuid(),
  owner: AuthUserSchema,
  creatorSeat: playerSchema,
  rated: z.boolean(),
  timeControl: timeControlSchema,
  createdAt: z.iso.datetime(),
});

export const WaitingGameSnapshotSchema: z.ZodType<WaitingGameSnapshot> = waitingGameSnapshotSchema;
export const ReadyCheckGameSnapshotSchema: z.ZodType<ReadyCheckGameSnapshot> =
  readyCheckGameSnapshotSchema;
export const ActiveGameSnapshotSchema: z.ZodType<ActiveGameSnapshot> = activeGameSnapshotSchema;
export const FinishedGameSnapshotSchema: z.ZodType<FinishedGameSnapshot> =
  finishedGameSnapshotSchema;

/** Status-specific unions reject structurally incomplete snapshots. */
export const GameSnapshotSchema: z.ZodType<GameSnapshot> = z
  .discriminatedUnion("status", [
    waitingGameSnapshotSchema,
    readyCheckGameSnapshotSchema,
    activeGameSnapshotSchema,
    finishedGameSnapshotSchema,
  ])
  .superRefine((game, context) => {
    const timed = game.timeControl.kind === "timed";

    // The second confirmation must transition the snapshot to active.
    if (
      game.status === "ready_check" &&
      game.readyCheck.playerOneReady &&
      game.readyCheck.playerTwoReady
    ) {
      context.addIssue({
        code: "custom",
        path: ["readyCheck"],
        message: "A game both players have confirmed is active, not a ready check",
      });
    }
    const started = game.status === "active" || game.status === "finished";
    if (started && timed !== (game.clock !== null)) {
      context.addIssue({
        code: "custom",
        path: ["clock"],
        message: "Clock presence must match the persisted time control",
      });
    }

    if (game.status === "finished" && game.outcome.reason === "timeout" && !timed) {
      context.addIssue({
        code: "custom",
        path: ["outcome", "reason"],
        message: "Only a timed game may finish by timeout",
      });
    }

    if (game.status === "finished" && game.outcome.reason === "timeout" && game.clock !== null) {
      const loser = game.outcome.winner === PLAYER_ONE ? "playerTwo" : "playerOne";
      if (game.clock.remainingMs[loser] !== 0) {
        context.addIssue({
          code: "custom",
          path: ["clock", "remainingMs", loser],
          message: "The player who lost on time must have no time remaining",
        });
      }
    }

    if (game.status === "active" && game.clock !== null) {
      const serverNow = Date.parse(game.clock.serverNow);
      const deadline = Date.parse(game.clock.deadline);
      const expected = Math.max(0, deadline - serverNow);
      const running = game.clock.runningPlayer === PLAYER_ONE ? "playerOne" : "playerTwo";
      if (game.clock.remainingMs[running] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["clock", "remainingMs", running],
          message: "The running balance must match the authoritative deadline",
        });
      }
    }
  });
