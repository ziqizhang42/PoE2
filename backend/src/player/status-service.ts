import type { PlayerStatus, WsPlayersStatusMessage } from "@poe2/protocol";

import type { ConnectionHub } from "../http/ws-hub.js";
import type { PlayerActivityRecord } from "./repository.js";

export interface PlayerActivityReader {
  listPlayerActivities(): Promise<readonly PlayerActivityRecord[]>;
}

export interface PlayerStatusService {
  snapshot(): Promise<WsPlayersStatusMessage>;
}

/** Combines durable game activity with process-local, tab-deduplicated presence. */
export function createPlayerStatusService(
  activityReader: PlayerActivityReader,
  hub: Pick<ConnectionHub, "connectedUserIds">,
): PlayerStatusService {
  // Full replacements must not overtake one another: an older database read
  // landing last would otherwise resurrect activity that a later transition ended.
  let reads = Promise.resolve();

  const readSnapshot = async (): Promise<WsPlayersStatusMessage> => {
    const players = new Map<string, PlayerStatus>();

    for (const record of await activityReader.listPlayerActivities()) {
      players.set(record.id, { id: record.id, online: false, activity: record.activity });
    }

    // Read presence after the database await so a closing connection is not
    // resurrected by an older activity read completing late.
    for (const id of hub.connectedUserIds()) {
      const existing = players.get(id);
      players.set(id, {
        id,
        online: true,
        activity: existing?.activity ?? null,
      });
    }

    return {
      type: "players.status",
      players: [...players.values()].sort((left, right) => left.id.localeCompare(right.id)),
    };
  };

  return {
    snapshot() {
      const result = reads.then(readSnapshot);
      reads = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
}
