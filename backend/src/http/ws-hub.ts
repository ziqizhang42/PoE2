/**
 * In-memory sockets only. Pending connections buffer broadcasts until activation
 * so the opening sequence remains ordered; PostgreSQL remains authoritative.
 */

import type { WsServerMessage } from "@poe2/protocol";
import type { WebSocket } from "ws";

export interface ConnectionHub {
  /** Registers a socket that buffers hub traffic until it is activated. */
  /** Returns true when this is the user's first connection. */
  add(userId: string, socket: WebSocket): boolean;
  /** Flushes anything buffered, in arrival order, and starts live delivery. */
  activate(userId: string, socket: WebSocket): void;
  /** Returns true when this removed the user's last connection. */
  remove(userId: string, socket: WebSocket): boolean;
  /** Delivers to every socket the user currently has open, so tabs stay in step. */
  send(userId: string, message: WsServerMessage): void;
  broadcast(message: WsServerMessage, excludedSocket?: WebSocket): void;
  connectionCount(userId: string): number;
  connectedUserIds(): readonly string[];
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
      const first = connections.size === 0;
      connections.set(socket, { buffered: [] });
      connectionsByUser.set(userId, connections);
      return first;
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
        return false;
      }

      if (!connections.delete(socket)) {
        return false;
      }
      if (connections.size === 0) {
        connectionsByUser.delete(userId);
        return true;
      }
      return false;
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

    broadcast(message, excludedSocket) {
      const payload = JSON.stringify(message);
      for (const connections of connectionsByUser.values()) {
        for (const [socket, connection] of connections) {
          if (socket === excludedSocket) {
            continue;
          }
          deliver(socket, connection, payload);
        }
      }
    },

    connectionCount: (userId) => connectionsByUser.get(userId)?.size ?? 0,

    connectedUserIds: () => [...connectionsByUser.keys()].sort(),

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
