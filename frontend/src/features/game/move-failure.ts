import {
  describeTransportFailure,
  UNEXPECTED_FAILURE,
  type FailedCommand,
} from "../command-failure.ts";

/** Server refusals are certain; post-send transport failures remain unknown. */
export function describeMoveFailure(result: FailedCommand): string {
  return describeTransportFailure(result.failure, "game") ?? describeRejection(result);
}

export function describeWithdrawalFailure(result: FailedCommand): string {
  return (
    describeTransportFailure(result.failure, "game") ??
    describeGameActionRejection(result, "withdrawal")
  );
}

export function describeResignationFailure(result: FailedCommand): string {
  return (
    describeTransportFailure(result.failure, "game") ??
    describeGameActionRejection(result, "resignation")
  );
}

export function describeReadyConfirmationFailure(result: FailedCommand): string {
  return (
    describeTransportFailure(result.failure, "game") ??
    describeGameActionRejection(result, "confirmation")
  );
}

export function describeReadyDepartureFailure(result: FailedCommand): string {
  return (
    describeTransportFailure(result.failure, "game") ??
    describeGameActionRejection(result, "departure")
  );
}

function describeRejection(result: FailedCommand): string {
  switch (result.code) {
    case "stale_game":
      return "The position had already moved on, so your move was not played. The board below is the current one; play from that.";
    case "occupied":
      return "That square was taken before your move arrived, so nothing was played.";
    case "not_your_turn":
      return "It was not your turn, so nothing was played.";
    case "game_over":
      return "This game is already finished, so nothing was played.";
    case "not_a_player":
      return "You hold no seat in this game, so nothing was played.";
    case "game_not_found":
      return "The server has no record of this game.";
    case "game_not_ready_check":
      return "The check has already been settled - it either started or ran out.";
    case "rate_limited":
      return "That was too many commands at once, so nothing was played. Wait a moment and try again.";
    case "invalid_message":
    case "internal_error":
      return "The server refused that move.";
    default:
      return result.message ?? UNEXPECTED_FAILURE;
  }
}

type GameAction = "withdrawal" | "resignation" | "confirmation" | "departure";

function describeGameActionRejection(result: FailedCommand, action: GameAction): string {
  const notApplied: Record<GameAction, string> = {
    withdrawal: "The lobby was not withdrawn.",
    resignation: "You did not resign.",
    confirmation: "You were not marked ready.",
    departure: "You did not leave the ready check.",
  };

  switch (result.code) {
    case "game_not_found":
      return "The server has no record of this game.";
    case "game_not_waiting":
      return "This game is no longer a waiting lobby, so it was not withdrawn.";
    case "not_lobby_owner":
      return "Only the player who opened this lobby can withdraw it.";
    case "game_not_ready_check":
      return "The ready check has already been settled — it either started or ran out.";
    case "stale_game":
      return action === "confirmation" || action === "departure"
        ? `That ready check had already been replaced by a newer one. ${notApplied[action]}`
        : `The game had already moved on. ${notApplied[action]}`;
    case "game_over":
      return "This game is already finished, so the resignation was not accepted.";
    case "not_a_player":
      return `You hold no seat in this game. ${notApplied[action]}`;
    case "rate_limited":
      return `That was too many commands at once. ${notApplied[action]} Wait a moment and try again.`;
    case "invalid_message":
    case "internal_error":
      return `The server refused that ${action}.`;
    default:
      return result.message ?? UNEXPECTED_FAILURE;
  }
}
