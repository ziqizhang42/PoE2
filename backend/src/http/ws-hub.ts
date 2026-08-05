/**
 * In-memory registry of live sockets, keyed by authenticated user ID.
 *
 * It holds connections and nothing else. No game, lobby, or turn ever lives
 * here: losing the whole hub costs open sockets, never state, because
 * PostgreSQL remains the only authority on what a game is.
 *
 * A connection is added in a pending state and buffers everything addressed to
 * it until `activate` is called. That window is what lets a caller send an
 * opening sequence in a guaranteed order without another user's broadcast
 * landing in the middle of it.
 */

import type { WsServerMessage } from "@poe2/protocol";
import type { WebSocket } from "ws";

export interface ConnectionHub {
  /** Registers a socket that buffers hub traffic until it is activated. */
  add(userId: string, socket: WebSocket): void;
  /** Flushes anything buffered, in arrival order, and starts live delivery. */
  activate(userId: string, socket: WebSocket): void;
  remove(userId: string, socket: WebSocket): void;
  /** Delivers to every socket the user currently has open, so tabs stay in step. */
  send(userId: string, message: WsServerMessage): void;
  broadcast(message: WsServerMessage): void;
  connectionCount(userId: string): number;
  totalConnections(): number;
}

const OPEN: number = 1;

interface Connection {
  /** Payloads held back while the connection is pending; `null` once live. */
  buffered: string[] | null;
}

export function sendMessage(socket: WebSocket, message: WsServerMessage): void {
  sendPayload(socket, JSON.stringify(message));
}

export function createConnectionHub(): ConnectionHub {
  const connectionsByUser = new Map<string, Map<WebSocket, Connection>>();

  return {
    add(userId, socket) {
      const connections = connectionsByUser.get(userId) ?? new Map<WebSocket, Connection>();
      connections.set(socket, { buffered: [] });
      connectionsByUser.set(userId, connections);
    },

    activate(userId, socket) {
      const connection = connectionsByUser.get(userId)?.get(socket);
      if (connection === undefined || connection.buffered === null) {
        return;
      }

      const held = connection.buffered;
      connection.buffered = null;
      for (const payload of held) {
        sendPayload(socket, payload);
      }
    },

    remove(userId, socket) {
      const connections = connectionsByUser.get(userId);
      if (connections === undefined) {
        return;
      }

      connections.delete(socket);
      if (connections.size === 0) {
        connectionsByUser.delete(userId);
      }
    },

    send(userId, message) {
      const connections = connectionsByUser.get(userId);
      if (connections === undefined) {
        return;
      }

      const payload = JSON.stringify(message);
      for (const [socket, connection] of connections) {
        deliver(socket, connection, payload);
      }
    },

    broadcast(message) {
      const payload = JSON.stringify(message);
      for (const connections of connectionsByUser.values()) {
        for (const [socket, connection] of connections) {
          deliver(socket, connection, payload);
        }
      }
    },

    connectionCount: (userId) => connectionsByUser.get(userId)?.size ?? 0,

    totalConnections() {
      let total = 0;
      for (const connections of connectionsByUser.values()) {
        total += connections.size;
      }
      return total;
    },
  };
}

function deliver(socket: WebSocket, connection: Connection, payload: string): void {
  if (connection.buffered === null) {
    sendPayload(socket, payload);
  } else {
    connection.buffered.push(payload);
  }
}

/** Silently skips a socket that is closing or already closed. */
function sendPayload(socket: WebSocket, payload: string): void {
  if (socket.readyState === OPEN) {
    socket.send(payload);
  }
}
