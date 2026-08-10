import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { installGracefulShutdown, type ShutdownSignalSource } from "./graceful-shutdown.js";

function createHarness(close: () => Promise<undefined>) {
  const signalSource = new EventEmitter();
  const info = vi.fn();
  const error = vi.fn();
  const setExitCode = vi.fn();
  const shutdown = installGracefulShutdown(
    {
      close,
      log: { info, error } as never,
    },
    { signalSource: signalSource as ShutdownSignalSource, setExitCode },
  );

  return { error, info, setExitCode, shutdown, signalSource };
}

describe("installGracefulShutdown", () => {
  it("closes Fastify when the process receives SIGTERM", async () => {
    const close = vi.fn(() => Promise.resolve(undefined));
    const harness = createHarness(close);

    harness.signalSource.emit("SIGTERM");
    await harness.shutdown.request("SIGTERM");

    expect(close).toHaveBeenCalledOnce();
    expect(harness.info).toHaveBeenCalledWith({ signal: "SIGTERM" }, "shutdown requested");
    expect(harness.setExitCode).not.toHaveBeenCalled();
  });

  it("shares one close operation across repeated signals", async () => {
    const close = vi.fn(() => Promise.resolve(undefined));
    const harness = createHarness(close);

    harness.signalSource.emit("SIGTERM");
    harness.signalSource.emit("SIGINT");
    await harness.shutdown.request("SIGINT");

    expect(close).toHaveBeenCalledOnce();
    expect(harness.info).toHaveBeenCalledOnce();
  });

  it("reports a close failure and requests a failing exit status", async () => {
    const failure = new Error("close failed");
    const harness = createHarness(() => Promise.reject(failure));

    await harness.shutdown.request("SIGINT");

    expect(harness.error).toHaveBeenCalledWith(
      { err: failure, signal: "SIGINT" },
      "graceful shutdown failed",
    );
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
  });

  it("can remove handlers before ownership moves elsewhere", () => {
    const close = vi.fn(() => Promise.resolve(undefined));
    const harness = createHarness(close);

    harness.shutdown.dispose();
    harness.signalSource.emit("SIGTERM");

    expect(close).not.toHaveBeenCalled();
  });
});
