import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LiveCommandResult } from "../live/client.ts";
import { ACCEPTED, rejectedCommand, REQUEST_ID } from "../test/fakes.ts";
import { describeCommandFailure } from "./lobby/command-failure.ts";
import { useCommandRunner } from "./use-command-runner.ts";

function deferred() {
  let settle: (result: LiveCommandResult) => void = () => {};
  const promise = new Promise<LiveCommandResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle: (result: LiveCommandResult) => settle(result) };
}

describe("useCommandRunner", () => {
  it("drops a second command while one is in flight", async () => {
    const { promise, settle } = deferred();
    const command = vi.fn(() => promise);
    const { result } = renderHook(() => useCommandRunner(describeCommandFailure));

    act(() => {
      result.current.run("create", command);
      result.current.run("create", command);
    });

    expect(command).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe("create");

    await act(async () => {
      settle(ACCEPTED);
      await promise;
    });

    expect(result.current.pending).toBeNull();
    expect(result.current.failure).toBeNull();
  });

  it("reports a refusal and clears it on the next attempt", async () => {
    const { result } = renderHook(() => useCommandRunner(describeCommandFailure));

    act(() => {
      result.current.run("join", async () => rejectedCommand("game_not_waiting"));
    });

    await waitFor(() => {
      expect(result.current.failure).toBe("Someone else took that seat first.");
    });
    expect(result.current.failureKey).toBe("join");

    const { promise, settle } = deferred();
    act(() => {
      result.current.run("join", () => promise);
    });

    expect(result.current.failure).toBeNull();
    expect(result.current.failureKey).toBeNull();

    await act(async () => {
      settle(ACCEPTED);
      await promise;
    });
  });

  it("can describe one action differently while keeping a shared in-flight gate", async () => {
    const { result } = renderHook(() => useCommandRunner(describeCommandFailure));

    act(() => {
      result.current.run(
        "withdraw",
        async () => rejectedCommand("rate_limited"),
        () => "The lobby was not withdrawn.",
      );
    });

    await waitFor(() => {
      expect(result.current.failure).toBe("The lobby was not withdrawn.");
    });
    expect(result.current.failureKey).toBe("withdraw");
  });

  it("settles even when a command rejects outright", async () => {
    const { result } = renderHook(() => useCommandRunner(describeCommandFailure));

    act(() => {
      result.current.run("create", () => Promise.reject(new Error("boom")));
    });

    await waitFor(() => {
      expect(result.current.pending).toBeNull();
    });
    expect(result.current.failure).toContain("unknown reason");
  });

  it("accepts a new command once the previous one has settled", async () => {
    const second = vi.fn(
      async (): Promise<LiveCommandResult> => ({ ok: true, requestId: REQUEST_ID }),
    );
    const { result } = renderHook(() => useCommandRunner(describeCommandFailure));

    act(() => {
      result.current.run("first", async () => ACCEPTED);
    });
    await waitFor(() => {
      expect(result.current.pending).toBeNull();
    });

    act(() => {
      result.current.run("second", second);
    });

    expect(second).toHaveBeenCalledTimes(1);
  });
});
