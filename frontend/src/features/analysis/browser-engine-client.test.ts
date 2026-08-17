import { describe, expect, it, vi, type Mock } from "vitest";

import { engineSuccess } from "../../test/engine.ts";
import { BrowserEngineClient, type EngineSearchCallbacks } from "./browser-engine-client.ts";
import type { EngineWorkerCommand, EngineWorkerEvent } from "./engine-worker-protocol.ts";

class FakeWorker {
  onmessage: Worker["onmessage"] = null;
  onerror: Worker["onerror"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  readonly posted: EngineWorkerCommand[] = [];
  readonly terminate = vi.fn();

  postMessage(command: EngineWorkerCommand): void {
    this.posted.push(command);
  }

  emit(data: EngineWorkerEvent): void {
    this.onmessage?.call(this as unknown as Worker, new MessageEvent("message", { data }));
  }
}

function callbacks(): EngineSearchCallbacks & {
  readonly onStarted: Mock<EngineSearchCallbacks["onStarted"]>;
  readonly onProgress: Mock<EngineSearchCallbacks["onProgress"]>;
  readonly onResult: Mock<EngineSearchCallbacks["onResult"]>;
  readonly onFailure: Mock<EngineSearchCallbacks["onFailure"]>;
} {
  return {
    onStarted: vi.fn<EngineSearchCallbacks["onStarted"]>(),
    onProgress: vi.fn<EngineSearchCallbacks["onProgress"]>(),
    onResult: vi.fn<EngineSearchCallbacks["onResult"]>(),
    onFailure: vi.fn<EngineSearchCallbacks["onFailure"]>(),
  };
}

describe("BrowserEngineClient", () => {
  it("routes request-scoped progress and reuses a completed Worker", () => {
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker as unknown as Worker);
    const client = new BrowserEngineClient(createWorker);
    const first = callbacks();

    client.analyze({ moves: [], searchTimeMs: 1_000, multiPv: 1 }, first);
    expect(worker.posted[0]).toEqual({
      type: "analyze",
      requestId: 1,
      request: { moves: [], searchTimeMs: 1_000, multiPv: 1 },
    });

    worker.emit({ type: "started", requestId: 1 });
    worker.emit({
      type: "progress",
      requestId: 1,
      update: engineSuccess("d4", 1),
      elapsedMs: 250,
    });
    worker.emit({ type: "result", requestId: 1, response: engineSuccess("d4", 3) });

    expect(first.onStarted).toHaveBeenCalledOnce();
    expect(first.onProgress).toHaveBeenCalledWith(engineSuccess("d4", 1), 250);
    expect(first.onResult).toHaveBeenCalledWith(engineSuccess("d4", 3));

    client.analyze({ moves: ["d4"], searchTimeMs: 5_000, multiPv: 3 }, callbacks());
    expect(createWorker).toHaveBeenCalledOnce();
    expect(worker.posted[1]).toMatchObject({ type: "analyze", requestId: 2 });
  });

  it("terminates for cancellation and ignores messages from the dead request", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const client = new BrowserEngineClient(() => workers.shift() as unknown as Worker);
    const first = callbacks();
    const handle = client.analyze({ moves: [], searchTimeMs: 20_000 }, first);

    handle.cancel();
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    firstWorker.emit({ type: "result", requestId: 1, response: engineSuccess() });
    expect(first.onResult).not.toHaveBeenCalled();

    client.analyze({ moves: [], searchTimeMs: 1_000 }, callbacks());
    expect(secondWorker.posted[0]).toMatchObject({ type: "analyze", requestId: 2 });
  });
});
