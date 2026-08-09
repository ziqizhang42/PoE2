import {
  describeTransportFailure,
  UNEXPECTED_FAILURE,
  type FailedCommand,
} from "../command-failure.ts";

export function describeCommandFailure(result: FailedCommand): string {
  return describeTransportFailure(result.failure, "lobby") ?? describeRejection(result);
}

function describeRejection(result: FailedCommand): string {
  switch (result.code) {
    case "game_not_found":
      return "That lobby is no longer there.";
    case "game_not_waiting":
      return "Someone else took that seat first.";
    case "cannot_join_own_game":
      return "You opened that lobby, so you cannot take the other seat.";
    case "not_lobby_owner":
      return "Only the player who opened a lobby can withdraw it.";
    case "not_a_player":
      return "You hold no seat in that game.";
    case "lobby_already_open":
      return "You already have a lobby waiting. Withdraw it before opening another.";
    case "rated_requires_clock":
      return "A rated game needs a clock. Choose a time control, or open a casual game.";
    case "rate_limited":
      return "That was too many commands at once. Wait a moment and try again.";
    case "invalid_message":
    case "internal_error":
      return "The server refused that command.";
    default:
      return result.message ?? UNEXPECTED_FAILURE;
  }
}
