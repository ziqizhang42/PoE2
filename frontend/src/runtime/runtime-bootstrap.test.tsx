import type { AuthUser } from "@poe2/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_KEY } from "../auth/queries.ts";
import { gameReplayKey } from "../games/query-keys.ts";
import { useGameReplay } from "../games/queries.ts";
import {
  createFakeAuthClient,
  createTestRuntime,
  GAME_ID,
  gameReplay,
  USER_ONE,
  USER_TWO,
} from "../test/fakes.ts";
import { TestProviders } from "../test/providers.tsx";
import { RuntimeBootstrap } from "./runtime-bootstrap.tsx";

function MountedReplay() {
  const replay = useGameReplay(GAME_ID);
  return <p>{replay.data?.players.playerOne.username ?? "Replay pending"}</p>;
}

describe("RuntimeBootstrap", () => {
  it("renders nothing", () => {
    const runtime = createTestRuntime();
    const { container } = render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
      </TestProviders>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("opens the live connection once the session names a user", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_ONE.id);
    });
  });

  it("leaves the connection closed while the browser is signed out", async () => {
    const runtime = createTestRuntime();

    render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toBeNull();
    });

    expect(runtime.live.start).not.toHaveBeenCalled();
    expect(runtime.live.stop).toHaveBeenCalled();
  });

  it("closes the connection when the session is cleared", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_ONE.id);
    });

    runtime.queryClient.setQueryData<AuthUser | null>(AUTH_SESSION_KEY, null);

    await waitFor(() => {
      expect(runtime.live.stop).toHaveBeenCalled();
    });
  });

  it("does not churn the socket when the same user is refetched", async () => {
    const fetchSession = vi
      .fn<() => Promise<AuthUser | null>>()
      .mockImplementation(async () => ({ ...USER_ONE }));
    const runtime = createTestRuntime({ authClient: createFakeAuthClient({ fetchSession }) });

    render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledTimes(1);
    });

    await runtime.queryClient.refetchQueries({ queryKey: AUTH_SESSION_KEY });

    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(runtime.live.start).toHaveBeenCalledTimes(1);
  });

  it("restarts the connection when a different user signs in", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_ONE.id);
    });

    runtime.queryClient.setQueryData<AuthUser | null>(AUTH_SESSION_KEY, USER_TWO);

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_TWO.id);
    });

    expect(runtime.live.stop).toHaveBeenCalled();
  });

  it("leaves a mounted replay alone when the account changes underneath it", async () => {
    const replay = gameReplay(["A1"], { resignedBy: 1 });
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });
    runtime.gamesClient.fetchReplay.mockResolvedValue(replay);

    render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
        <MountedReplay />
      </TestProviders>,
    );

    expect(await screen.findByText(replay.players.playerOne.username)).toBeInTheDocument();
    runtime.queryClient.setQueryData<AuthUser | null>(AUTH_SESSION_KEY, USER_TWO);

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_TWO.id);
    });

    // Nothing is evicted and nothing is refetched: a finished game reads the
    // same for the account that arrived as for the one that left.
    expect(runtime.queryClient.getQueryData(gameReplayKey(GAME_ID))).toEqual(replay);
    expect(runtime.gamesClient.fetchReplay).toHaveBeenCalledTimes(1);
  });

  it("shuts the connection down when it unmounts", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    const { unmount } = render(
      <TestProviders runtime={runtime}>
        <RuntimeBootstrap />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalled();
    });

    runtime.live.stop.mockClear();
    unmount();

    expect(runtime.live.stop).toHaveBeenCalledTimes(1);
  });
});
