import type { AnalysisRequest, AnalysisResponse, AnalysisSuccess } from "@poe2/engine-wasm";

export type EngineWorkerCommand = {
  readonly type: "analyze";
  readonly requestId: number;
  readonly request: AnalysisRequest;
};

export type EngineWorkerEvent =
  | { readonly type: "started"; readonly requestId: number }
  | {
      readonly type: "progress";
      readonly requestId: number;
      readonly update: AnalysisSuccess;
      /** Monotonic wall time since the synchronous search started in the Worker. */
      readonly elapsedMs: number;
    }
  | {
      readonly type: "result";
      readonly requestId: number;
      readonly response: AnalysisResponse;
    }
  | {
      readonly type: "failure";
      readonly requestId: number;
      readonly message: string;
    };
