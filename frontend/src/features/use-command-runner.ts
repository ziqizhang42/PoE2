import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveCommandResult } from "../live/client.ts";
import { UNEXPECTED_FAILURE, type FailedCommand } from "./command-failure.ts";

export interface CommandRunner {
  readonly pending: string | null;
  readonly failure: string | null;
  readonly failureKey: string | null;
  run: (
    key: string,
    command: () => Promise<LiveCommandResult>,
    describe?: (result: FailedCommand) => string,
  ) => void;
}

/** Drops concurrent duplicate actions and leaves successful state to server pushes. */
export function useCommandRunner(describe: (result: FailedCommand) => string): CommandRunner {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [failureKey, setFailureKey] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const mounted = useRef(true);
  const describeRef = useRef(describe);

  describeRef.current = describe;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    (
      key: string,
      command: () => Promise<LiveCommandResult>,
      describeFailure?: (result: FailedCommand) => string,
    ) => {
      if (inFlight.current !== null) {
        return;
      }

      inFlight.current = key;
      setPending(key);
      setFailure(null);
      setFailureKey(null);
      const explain = describeFailure ?? describeRef.current;

      const settle = (message: string | null): void => {
        inFlight.current = null;
        if (!mounted.current) {
          return;
        }
        setPending(null);
        setFailure(message);
        setFailureKey(message === null ? null : key);
      };

      void command().then(
        (result) => {
          settle(result.ok ? null : explain(result));
        },
        () => {
          settle(UNEXPECTED_FAILURE);
        },
      );
    },
    [],
  );

  return { pending, failure, failureKey, run };
}
