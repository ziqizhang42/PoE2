/**
 * The one place the native WebSocket API is touched.
 *
 * Handlers are supplied when the socket is created, so a socket can never
 * accumulate a second set, and non-text frames are dropped here rather than
 * reaching the protocol layer.
 */

export const LIVE_SOCKET_PATH = "/api/ws";

export interface LiveSocket {
  send(payload: string): void;
  close(code: number, reason: string): void;
}

/**
 * There is no `onOpen`: an open transport is not a usable connection, and the
 * protocol layer waits for `session.ready` instead. An `error` event is always
 * followed by a close, so `onClose` is the only failure path.
 */
export interface LiveSocketHandlers {
  onMessage(payload: string): void;
  onClose(code: number): void;
}

export type LiveSocketFactory = (url: string, handlers: LiveSocketHandlers) => LiveSocket;

/** Same origin as the page, so the session cookie is sent with the upgrade. */
export function liveSocketUrl(location: Pick<Location, "host" | "protocol">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${LIVE_SOCKET_PATH}`;
}

export const createBrowserSocket: LiveSocketFactory = (url, handlers) => {
  const socket = new WebSocket(url);

  // Attached so a failed connection does not surface as an unhandled event.
  socket.onerror = () => {};

  socket.onclose = (event) => {
    handlers.onClose(event.code);
  };

  socket.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data === "string") {
      handlers.onMessage(event.data);
    }
  };

  return {
    send(payload) {
      socket.send(payload);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
  };
};
