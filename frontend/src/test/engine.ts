import type { AnalysisRequest, AnalysisSuccess, Move } from "@poe2/engine-wasm";

import {
  browserEngineClient,
  type AnalysisEngineClient,
  type EngineSearchCallbacks,
  type EngineSearchHandle,
} from "../features/analysis/browser-engine-client.ts";
import { clearEngineAnalysisCache } from "../features/analysis/engine-analysis-cache.ts";
import type {
  EngineWorkerCommand,
  EngineWorkerEvent,
} from "../features/analysis/engine-worker-protocol.ts";

/** The one fixture value coupled to the currently installed package contract. */
export const TEST_ENGINE_VERSION: AnalysisSuccess["engineVersion"] = "0.2.0";
export const TEST_ENGINE_API_VERSION: AnalysisSuccess["apiVersion"] = 1;

export interface FakeEngineSearch {
  readonly request: AnalysisRequest;
  readonly callbacks: EngineSearchCallbacks;
  canceled: boolean;
}

export class FakeEngineClient implements AnalysisEngineClient {
  readonly searches: FakeEngineSearch[] = [];

  analyze(request: AnalysisRequest, callbacks: EngineSearchCallbacks): EngineSearchHandle {
    const search: FakeEngineSearch = { request, callbacks, canceled: false };
    this.searches.push(search);
    return {
      cancel() {
        search.canceled = true;
      },
    };
  }
}

export class EngineWorkerProbe {
  static readonly instances: EngineWorkerProbe[] = [];

  onmessage: Worker["onmessage"] = null;
  onerror: Worker["onerror"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  readonly posted: EngineWorkerCommand[] = [];
  terminated = false;

  constructor() {
    EngineWorkerProbe.instances.push(this);
  }

  postMessage(command: EngineWorkerCommand): void {
    this.posted.push(command);
  }

  emit(data: EngineWorkerEvent): void {
    this.onmessage?.call(this as unknown as Worker, new MessageEvent("message", { data }));
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Installs a controllable Worker around the shared browser engine for a page test. */
export function installEngineWorkerProbe(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  EngineWorkerProbe.instances.length = 0;
  browserEngineClient.dispose();
  clearEngineAnalysisCache();
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: EngineWorkerProbe,
  });

  return () => {
    browserEngineClient.dispose();
    clearEngineAnalysisCache();
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, "Worker");
    } else {
      Object.defineProperty(globalThis, "Worker", descriptor);
    }
  };
}

export function engineSuccess(
  move: Move = "d4",
  evaluationHalfPoints = 0,
  options: { readonly completedDepth?: number; readonly nodes?: number } = {},
): AnalysisSuccess {
  return {
    ok: true,
    bestMove: move,
    evaluationHalfPoints,
    principalVariation: [move],
    lines: [
      {
        rank: 1,
        move,
        equivalentMoves: [move],
        evaluationHalfPoints,
        principalVariation: [move],
      },
    ],
    completedDepth: options.completedDepth ?? 5,
    nodes: options.nodes ?? 12_345,
    engineVersion: TEST_ENGINE_VERSION,
    apiVersion: TEST_ENGINE_API_VERSION,
  };
}
