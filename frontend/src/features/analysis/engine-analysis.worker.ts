import createEngine from "@poe2/engine-wasm";
import wasmUrl from "@poe2/engine-wasm/poe2-engine.wasm?url";

import type { EngineWorkerCommand, EngineWorkerEvent } from "./engine-worker-protocol.ts";

interface EngineWorkerScope {
  onmessage: ((event: MessageEvent<EngineWorkerCommand>) => void) | null;
  postMessage(message: EngineWorkerEvent): void;
}

const workerScope = self as unknown as EngineWorkerScope;
let enginePromise: ReturnType<typeof createEngine> | null = null;

workerScope.onmessage = (event) => {
  if (event.data.type === "analyze") {
    void analyze(event.data);
  }
};

async function analyze(command: EngineWorkerCommand): Promise<void> {
  try {
    enginePromise ??= createEngine({ wasmUrl });
    const engine = await enginePromise;
    workerScope.postMessage({ type: "started", requestId: command.requestId });
    const startedAt = performance.now();

    const response = engine.analyze(command.request, {
      onProgress(update) {
        workerScope.postMessage({
          type: "progress",
          requestId: command.requestId,
          update,
          elapsedMs: performance.now() - startedAt,
        });
      },
    });

    workerScope.postMessage({ type: "result", requestId: command.requestId, response });
  } catch (error) {
    enginePromise = null;
    workerScope.postMessage({
      type: "failure",
      requestId: command.requestId,
      message: errorMessage(error),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? `The analysis engine failed: ${error.message}`
    : "The analysis engine failed unexpectedly.";
}
