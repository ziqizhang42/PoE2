import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlayerDirectoryEntry } from "@poe2/protocol";

import {
  createFakeAuthClient,
  createTestRuntime,
  USER_ONE,
  USER_TWO,
  type TestRuntime,
} from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";

const DIRECTORY: readonly PlayerDirectoryEntry[] = [
  { id: USER_TWO.id, username: USER_TWO.username, rating: 1620, colorPercentile: 90 },
  { id: USER_ONE.id, username: USER_ONE.username, rating: 1500, colorPercentile: 50 },
];

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return {
    promise,
    resolve(value: T) {
      resolve?.(value);
    },
  };
}

describe("lobby player directory", () => {
  let runtime: TestRuntime;

  beforeEach(() => {
    runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });
    runtime.playersClient.fetchDirectory.mockResolvedValue(DIRECTORY);
    runtime.live.store.setState({
      status: "ready",
      userId: USER_ONE.id,
      synced: true,
      playerStatuses: [
        { id: USER_TWO.id, online: true, activity: "in_game" },
        { id: USER_ONE.id, online: false, activity: "open_room" },
      ],
    });
  });

  async function openDirectory() {
    renderApp(runtime, "/lobby");
    return within(await screen.findByRole("region", { name: "Players" }));
  }

  it("keeps the You card and puts Players beneath it", async () => {
    const directory = await openDirectory();
    const you = screen.getByRole("region", { name: "You" });
    const players = screen.getByRole("region", { name: "Players" });

    expect(within(you).getByRole("link", { name: USER_ONE.username })).toHaveAttribute(
      "href",
      `/player/${USER_ONE.username}`,
    );
    expect(you.compareDocumentPosition(players) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(directory.getByRole("radio", { name: "Online" })).toBeChecked();
  });

  it("defaults to Online and filters by deduplicated socket presence", async () => {
    const directory = await openDirectory();

    expect(await directory.findByRole("link", { name: USER_TWO.username })).toBeInTheDocument();
    expect(directory.queryByRole("link", { name: USER_ONE.username })).not.toBeInTheDocument();
    expect(directory.getAllByRole("row")).toHaveLength(2);
  });

  it("shows everybody in server order without ranks or a presence column", async () => {
    const directory = await openDirectory();
    await userEvent.click(directory.getByRole("radio", { name: "Overall" }));

    expect(directory.getAllByRole("link").map((link) => link.textContent)).toEqual([
      USER_TWO.username,
      USER_ONE.username,
    ]);
    const table = directory.getByRole("table");
    expect(within(table).queryByRole("columnheader", { name: /rank/i })).not.toBeInTheDocument();
    expect(within(table).queryByText(/online|offline/i)).not.toBeInTheDocument();
  });

  it("renders profile links, numeric ratings, percentile colors, and activity labels", async () => {
    const directory = await openDirectory();
    await userEvent.click(directory.getByRole("radio", { name: "Overall" }));

    const high = directory.getByRole("link", { name: USER_TWO.username });
    expect(high).toHaveAttribute("href", `/player/${USER_TWO.username}`);
    expect(high.getAttribute("style")).toContain("--tier-7");
    expect(directory.getByText("1620")).toHaveClass("num");
    expect(directory.getByRole("img", { name: "In game" })).toBeInTheDocument();
    expect(directory.getByRole("img", { name: "Open room" })).toBeInTheDocument();
  });

  it("shows a pending state until both HTTP data and opening status are complete", async () => {
    const pending = deferred<readonly PlayerDirectoryEntry[]>();
    runtime.playersClient.fetchDirectory.mockReturnValue(pending.promise);
    runtime.live.store.setState({ synced: false });

    const directory = await openDirectory();
    expect(directory.getByRole("status")).toHaveTextContent("Fetching players…");

    pending.resolve(DIRECTORY);
    runtime.live.store.setState({ synced: true });

    expect(await directory.findByRole("link", { name: USER_TWO.username })).toBeInTheDocument();
  });

  it("distinguishes an empty Online filter from an empty directory", async () => {
    runtime.live.store.setState({ playerStatuses: [] });
    const directory = await openDirectory();

    expect(await directory.findByText("Nobody is online.")).toBeInTheDocument();

    await userEvent.click(directory.getByRole("radio", { name: "Overall" }));
    expect(await directory.findByRole("link", { name: USER_TWO.username })).toBeInTheDocument();
  });

  it("renders an empty Overall directory", async () => {
    runtime.playersClient.fetchDirectory.mockResolvedValue([]);
    const directory = await openDirectory();

    await userEvent.click(directory.getByRole("radio", { name: "Overall" }));

    expect(await directory.findByText("No players yet.")).toBeInTheDocument();
  });

  it("offers an explicit retry after a failed request", async () => {
    runtime.playersClient.fetchDirectory.mockRejectedValueOnce(new Error("offline"));
    const directory = await openDirectory();

    expect(await directory.findByRole("alert")).toHaveTextContent(
      "The player list could not be loaded.",
    );

    runtime.playersClient.fetchDirectory.mockResolvedValueOnce(DIRECTORY);
    await userEvent.click(directory.getByRole("button", { name: "Retry" }));

    expect(await directory.findByRole("link", { name: USER_TWO.username })).toBeInTheDocument();
    expect(runtime.playersClient.fetchDirectory).toHaveBeenCalledTimes(2);
  });
});
