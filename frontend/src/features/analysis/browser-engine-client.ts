import type { AnalysisRequest, AnalysisResponse, AnalysisSuccess } from "@poe2/engine-wasm";

import type { EngineWorkerCommand, EngineWorkerEvent } from "./engine-worker-protocol.ts";

export interface EngineSearchCallbacks {
  readonly onStarted: () => void;
  readonly onProgress: (update: AnalysisSuccess, elapsedMs: number) => void;
  readonly onResult: (response: AnalysisResponse) => void;
  readonly onFailure: (message: string) => void;
}

export interface EngineSearchHandle {
  cancel(): void;
}

export interface AnalysisEngineClient {
  analyze(request: AnalysisRequest, callbacks: EngineSearchCallbacks): EngineSearchHandle;
}

interface ActiveSearch {
  readonly requestId: number;
  readonly callbacks: EngineSearchCallbacks;
}

type WorkerFactory = () => Worker;

/** Owns the one CPU-bound Worker shared by analysis screens in this tab. */
export class BrowserEngineClient implements AnalysisEngineClient {
  readonly #createWorker: WorkerFactory;
  #worker: Worker | null = null;
  #active: ActiveSearch | null = null;
  #nextRequestId = 1;

  constructor(createWorker: WorkerFactory = createBrowserWorker) {
    this.#createWorker = createWorker;
  }

  analyze(request: AnalysisRequest, callbacks: EngineSearchCallbacks): EngineSearchHandle {
    if (this.#active !== null) {
      this.#cancel(this.#active.requestId);
    }

    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    this.#active = { requestId, callbacks };

    try {
      const worker = this.#worker ?? this.#startWorker();
      const command: EngineWorkerCommand = { type: "analyze", requestId, request };
      worker.postMessage(command);
    } catch (error) {
      this.#failActive(workerFailureMessage(error));
    }

    return {
      cancel: () => {
        this.#cancel(requestId);
      },
    };
  }

  dispose(): void {
    this.#active = null;
    this.#stopWorker();
  }

  #startWorker(): Worker {
    const worker = this.#createWorker();
    worker.onmessage = (event: MessageEvent<EngineWorkerEvent>) => {
      this.#receive(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.#failActive(
        event.message.length > 0
          ? `The analysis Worker crashed: ${event.message}`
          : "The analysis Worker crashed.",
      );
    };
    worker.onmessageerror = () => {
      this.#failActive("The browser could not read a response from the analysis Worker.");
    };
    this.#worker = worker;
    return worker;
  }

  #receive(event: EngineWorkerEvent): void {
    const active = this.#active;
    if (active === null || active.requestId !== event.requestId) {
      return;
    }

    switch (event.type) {
      case "started":
        active.callbacks.onStarted();
        break;
      case "progress":
        active.callbacks.onProgress(event.update, event.elapsedMs);
        break;
      case "result":
        this.#active = null;
        active.callbacks.onResult(event.response);
        break;
      case "failure":
        this.#failActive(event.message);
        break;
    }
  }

  #cancel(requestId: number): void {
    if (this.#active?.requestId !== requestId) {
      return;
    }
    this.#active = null;
    // analyze() is synchronous inside the Worker, so termination is the only
    // way to interrupt a deadline that has not expired yet.
    this.#stopWorker();
  }

  #failActive(message: string): void {
    const active = this.#active;
    this.#active = null;
    this.#stopWorker();
    active?.callbacks.onFailure(message);
  }

  #stopWorker(): void {
    if (this.#worker === null) {
      return;
    }
    this.#worker.onmessage = null;
    this.#worker.onerror = null;
    this.#worker.onmessageerror = null;
    this.#worker.terminate();
    this.#worker = null;
  }
}

function createBrowserWorker(): Worker {
  return new Worker(new URL("./engine-analysis.worker.ts", import.meta.url), {
    name: "poe2-analysis-engine",
    type: "module",
  });
}

function workerFailureMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? `The analysis Worker could not start: ${error.message}`
    : "The analysis Worker could not start.";
}

export const browserEngineClient = new BrowserEngineClient();

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    browserEngineClient.dispose();
  });
}
