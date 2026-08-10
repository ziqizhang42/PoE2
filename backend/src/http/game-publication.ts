import type { GameSnapshot, LobbyEntry, WsServerMessage } from "@poe2/protocol";

import type { PlayerStatusService } from "../player/status-service.js";
import type { ConnectionHub } from "./ws-hub.js";

interface PublicationOptions {
  readonly hub: Pick<ConnectionHub, "broadcast" | "send">;
  readonly playerStatusService: PlayerStatusService;
}

interface AbandonedPublicationOptions extends PublicationOptions {
  readonly listWaitingLobbies: () => Promise<readonly LobbyEntry[]>;
}

/** Publishes a command- or deadline-driven finish after its transaction commits. */
export async function publishFinishedGame(
  options: PublicationOptions,
  game: GameSnapshot,
): Promise<void> {
  const snapshot: WsServerMessage = { type: "game.snapshot", game };
  options.hub.send(game.players.playerOne.id, snapshot);
  if (game.players.playerTwo !== null) {
    options.hub.send(game.players.playerTwo.id, snapshot);
  }

  if (game.rated) {
    options.hub.broadcast({ type: "players.changed" });
  }
  options.hub.broadcast(await options.playerStatusService.snapshot());
}

/** Publishes an expired or declined ready check, including the omitted joiner. */
export async function publishAbandonedGame(
  options: AbandonedPublicationOptions,
  game: GameSnapshot,
  releasedPlayerId: string,
): Promise<void> {
  options.hub.send(game.players.playerOne.id, { type: "game.snapshot", game });
  options.hub.send(releasedPlayerId, { type: "game.closed", gameId: game.id });
  options.hub.broadcast({
    type: "lobby.snapshot",
    lobbies: await options.listWaitingLobbies(),
  });
  options.hub.broadcast(await options.playerStatusService.snapshot());
}
