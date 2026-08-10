import process from "node:process";

import type { FastifyBaseLogger } from "fastify";

export type ShutdownSignal = "SIGINT" | "SIGTERM";

type SignalListener = () => void;

export interface ShutdownSignalSource {
  once(signal: ShutdownSignal, listener: SignalListener): unknown;
  off(signal: ShutdownSignal, listener: SignalListener): unknown;
}

export interface GracefulShutdown {
  request(signal: ShutdownSignal): Promise<void>;
  dispose(): void;
}

export interface GracefulShutdownOptions {
  readonly signalSource?: ShutdownSignalSource;
  readonly setExitCode?: (code: number) => void;
}

interface ShutdownApp {
  readonly log: Pick<FastifyBaseLogger, "error" | "info">;
  close(): Promise<unknown>;
}

const SHUTDOWN_SIGNALS: readonly ShutdownSignal[] = ["SIGINT", "SIGTERM"];

/** Connects container stop signals to Fastify's close lifecycle exactly once. */
export function installGracefulShutdown(
  app: ShutdownApp,
  options: GracefulShutdownOptions = {},
): GracefulShutdown {
  const signalSource = options.signalSource ?? process;
  const setExitCode = options.setExitCode ?? ((code: number) => (process.exitCode = code));
  let shutdown: Promise<void> | null = null;

  const request = (signal: ShutdownSignal): Promise<void> => {
    if (shutdown !== null) {
      return shutdown;
    }

    app.log.info({ signal }, "shutdown requested");
    const closing = Promise.resolve()
      .then(() => app.close())
      .then(() => undefined)
      .catch((error: unknown) => {
        app.log.error({ err: error, signal }, "graceful shutdown failed");
        setExitCode(1);
      });
    shutdown = closing;

    return closing;
  };

  const listeners = new Map<ShutdownSignal, SignalListener>();
  for (const signal of SHUTDOWN_SIGNALS) {
    const listener = () => {
      void request(signal);
    };
    listeners.set(signal, listener);
    signalSource.once(signal, listener);
  }

  return {
    request,
    dispose() {
      for (const [signal, listener] of listeners) {
        signalSource.off(signal, listener);
      }
    },
  };
}
