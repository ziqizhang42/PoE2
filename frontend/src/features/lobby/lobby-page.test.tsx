import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { UNTIMED } from "@poe2/protocol";
import { PLAYER_ONE, PLAYER_TWO } from "@poe2/rules";

import {
  ACCEPTED,
  activeGame,
  createFakeAuthClient,
  createTestRuntime,
  GAME_ID,
  lobbyEntry,
  OTHER_GAME_ID,
  readyCheckGame,
  rejectedCommand,
  USER_ONE,
  USER_TWO,
  waitingGame,
  type TestRuntime,
} from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";

function signedInRuntime(): TestRuntime {
  return createTestRuntime({
    authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
  });
}

function ready(runtime: TestRuntime): void {
  runtime.live.store.setState({
    status: "ready",
    userId: USER_ONE.id,
    synced: true,
    playerStatuses: [{ id: USER_ONE.id, online: true, activity: null }],
  });
}

async function openLobby(runtime: TestRuntime): Promise<void> {
  renderApp(runtime, "/lobby");
  await screen.findByRole("heading", { name: "Create a game or take a seat" });
}

async function showNewGame(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "New game" }));
  await screen.findByRole("dialog", { name: "New game" });
}

describe("LobbyPage", () => {
  let runtime: TestRuntime;

  beforeEach(() => {
    runtime = signedInRuntime();
  });

  it("says it is connecting and refuses commands until the server answers", async () => {
    await openLobby(runtime);
    const main = within(screen.getByRole("main"));

    expect(main.getByText("Connecting to the game server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New game" })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "New game" })).not.toBeInTheDocument();
  });

  it("withholds partial opening lists until synchronization finishes", async () => {
    runtime.live.store.setState({
      status: "connecting",
      userId: USER_ONE.id,
      lobbies: [lobbyEntry(OTHER_GAME_ID, USER_TWO)],
      games: [activeGame(GAME_ID, USER_ONE, USER_TWO)],
      synced: false,
    });
    await openLobby(runtime);

    expect(screen.queryByRole("region", { name: /Open rooms/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Your games/ })).not.toBeInTheDocument();
    expect(screen.queryByText(USER_TWO.username)).not.toBeInTheDocument();

    runtime.live.store.setState({ status: "ready", synced: true });

    expect(await screen.findByRole("region", { name: /Open rooms/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Your games/ })).not.toBeInTheDocument();
  });

  it("counts reconnection attempts", async () => {
    runtime.live.store.setState({
      status: "reconnecting",
      userId: USER_ONE.id,
      reconnectAttempts: 2,
    });
    await openLobby(runtime);
    const main = within(screen.getByRole("main"));

    expect(main.getByText("Reconnecting")).toBeInTheDocument();
    expect(main.getByText(/Attempt 2\./)).toBeInTheDocument();
  });

  it("says so when the server has ended the session", async () => {
    runtime.live.store.setState({ status: "unauthenticated", userId: USER_ONE.id });
    await openLobby(runtime);
    const main = within(screen.getByRole("main"));

    expect(main.getByText("This session has ended")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New game" })).toBeDisabled();
  });

  it("lists other players' lobbies and leaves out the viewer's own", async () => {
    ready(runtime);
    runtime.live.store.setState({
      lobbies: [lobbyEntry(GAME_ID, USER_ONE), lobbyEntry(OTHER_GAME_ID, USER_TWO)],
    });
    await openLobby(runtime);

    const panel = within(screen.getByRole("region", { name: /Open rooms/ }));
    expect(panel.getByText(USER_TWO.username)).toBeInTheDocument();
    expect(panel.queryByText(USER_ONE.username)).not.toBeInTheDocument();
    expect(panel.getAllByRole("button", { name: "Join" })).toHaveLength(1);
  });

  it("refreshes relative lobby ages while the screen is otherwise quiet", async () => {
    ready(runtime);
    runtime.live.store.setState({
      lobbies: [
        {
          ...lobbyEntry(OTHER_GAME_ID, USER_TWO),
          createdAt: new Date(Date.now()).toISOString(),
        },
      ],
    });
    await openLobby(runtime);

    const opened = screen.getByRole("time");
    expect(opened).toHaveTextContent("just now");

    runtime.clock.advance(60_000);
    runtime.clock.fire();

    await waitFor(() => {
      expect(opened).toHaveTextContent("1 min");
    });
  });

  it("keeps game settings in a dismissible New game dialog", async () => {
    const user = userEvent.setup();
    ready(runtime);
    await openLobby(runtime);

    const trigger = screen.getByRole("button", { name: "New game" });
    expect(screen.queryByRole("dialog", { name: "New game" })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "New game" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens a lobby once, however often the button is pressed", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    runtime.live.createLobby.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ ok: true, requestId: GAME_ID });
          };
        }),
    );

    ready(runtime);
    await openLobby(runtime);
    await showNewGame();

    await user.click(screen.getByRole("button", { name: "Create game" }));

    const pending = await screen.findByRole("button", { name: "Creating…" });
    expect(pending).toBeDisabled();
    await user.click(pending);

    expect(runtime.live.createLobby).toHaveBeenCalledTimes(1);
    release();
  });

  describe("opening a lobby", () => {
    it("takes the reader into the game the server opened for them", async () => {
      const user = userEvent.setup();
      ready(runtime);
      runtime.live.createLobby.mockImplementation(async () => {
        runtime.live.store.setState({ games: [waitingGame(OTHER_GAME_ID, USER_ONE)] });
        return ACCEPTED;
      });
      await openLobby(runtime);
      await showNewGame();

      await user.click(screen.getByRole("button", { name: "Create game" }));

      expect(await screen.findByRole("grid")).toBeInTheDocument();
      expect(screen.getByText("Waiting for a second player")).toBeInTheDocument();
    });

    it("waits for the snapshot rather than the acknowledgement", async () => {
      const user = userEvent.setup();
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await user.click(screen.getByRole("button", { name: "Create game" }));

      await waitFor(() => {
        expect(runtime.live.createLobby).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByRole("heading", { name: "Create a game or take a seat" })).toBeInTheDocument();

      runtime.live.store.setState({ games: [waitingGame(OTHER_GAME_ID, USER_ONE)] });

      expect(await screen.findByRole("grid")).toBeInTheDocument();
    });

    it("tells apart the game it just opened from the ones already held", async () => {
      const user = userEvent.setup();
      ready(runtime);
      runtime.live.store.setState({ games: [waitingGame(GAME_ID, USER_ONE)] });
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await user.click(screen.getByRole("button", { name: "Create game" }));
      runtime.live.store.setState({
        games: [waitingGame(GAME_ID, USER_ONE), waitingGame(OTHER_GAME_ID, USER_ONE)],
      });

      await waitFor(() => {
        expect(window.location.pathname).toBe(`/game/${OTHER_GAME_ID}`);
      });
    });

    it("stays put when the server refused to open one", async () => {
      const user = userEvent.setup();
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(rejectedCommand("rate_limited", "Too many."));
      await openLobby(runtime);
      await showNewGame();

      await user.click(screen.getByRole("button", { name: "Create game" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "That was too many commands at once",
      );
      runtime.live.store.setState({ games: [waitingGame(OTHER_GAME_ID, USER_ONE)] });
      expect(screen.getByRole("heading", { name: "Create a game or take a seat" })).toBeInTheDocument();
    });

    it("opens a lobby whose acknowledgement was lost", async () => {
      const user = userEvent.setup();
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue({
        ok: false,
        requestId: GAME_ID,
        failure: "timed_out",
        code: null,
        message: null,
      });
      await openLobby(runtime);
      await showNewGame();

      await user.click(screen.getByRole("button", { name: "Create game" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/unknown/i);

      runtime.live.store.setState({ games: [waitingGame(OTHER_GAME_ID, USER_ONE)] });

      expect(await screen.findByRole("grid")).toBeInTheDocument();
      expect(window.location.pathname).toBe(`/game/${OTHER_GAME_ID}`);
    });
  });

  it("joins another player's lobby by id", async () => {
    const user = userEvent.setup();
    ready(runtime);
    runtime.live.store.setState({ lobbies: [lobbyEntry(OTHER_GAME_ID, USER_TWO)] });
    await openLobby(runtime);

    await user.click(screen.getByRole("button", { name: "Join" }));

    await waitFor(() => {
      expect(runtime.live.joinLobby).toHaveBeenCalledWith(OTHER_GAME_ID);
    });
  });

  it("opens the game it just took a seat in", async () => {
    const user = userEvent.setup();
    ready(runtime);
    runtime.live.store.setState({
      lobbies: [lobbyEntry(OTHER_GAME_ID, USER_TWO)],
      games: [readyCheckGame({ gameId: OTHER_GAME_ID, playerTwo: USER_ONE })],
    });
    await openLobby(runtime);

    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByRole("dialog", { name: "Ready to play?" })).toBeInTheDocument();
  });

  describe("a ready check that arrives while you are here", () => {
    it("opens over the lobby, without navigating anybody", async () => {
      ready(runtime);
      await openLobby(runtime);

      runtime.live.store.setState({
        games: [readyCheckGame({ playerOne: USER_ONE, playerTwo: USER_TWO })],
      });

      expect(await screen.findByRole("dialog", { name: "Ready to play?" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Create a game or take a seat" })).toBeInTheDocument();
    });

    it("answers from where it opened, rather than sending the reader to the board", async () => {
      const user = userEvent.setup();
      ready(runtime);
      runtime.live.store.setState({
        games: [readyCheckGame({ playerOne: USER_ONE, playerTwo: USER_TWO })],
      });
      await openLobby(runtime);

      await user.click(await screen.findByRole("button", { name: "I'm ready" }));

      expect(runtime.live.readyGame).toHaveBeenCalledWith({
        gameId: GAME_ID,
        readyCheckGeneration: 1,
      });
      expect(screen.getByRole("heading", { name: "Create a game or take a seat" })).toBeInTheDocument();
    });

    it("reveals the next check once this seat has confirmed the earlier one", async () => {
      ready(runtime);
      const first = readyCheckGame({ gameId: GAME_ID });
      const second = readyCheckGame({ gameId: OTHER_GAME_ID });
      runtime.live.store.setState({
        games: [first, second],
        gameReceivedAtMs: { [GAME_ID]: 0, [OTHER_GAME_ID]: 0 },
      });
      await openLobby(runtime);

      expect(screen.getByRole("dialog", { name: "Ready to play?" })).toHaveTextContent(
        "60 seconds left",
      );

      runtime.clock.advance(20_000);
      runtime.live.store.setState({
        games: [readyCheckGame({ gameId: GAME_ID, playerOneReady: true }), second],
        // Preserve the queued check's original receipt anchor.
        gameReceivedAtMs: { [GAME_ID]: 20_000, [OTHER_GAME_ID]: 0 },
      });

      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: "Ready to play?" })).toHaveTextContent(
          "40 seconds left",
        );
      });
    });

    it("describes a refused confirmation without calling it a move", async () => {
      ready(runtime);
      runtime.live.readyGame.mockResolvedValue(rejectedCommand("rate_limited"));
      runtime.live.store.setState({ games: [readyCheckGame()] });
      await openLobby(runtime);

      await userEvent.click(screen.getByRole("button", { name: "I'm ready" }));

      const dialog = screen.getByRole("dialog", { name: "Ready to play?" });
      expect(dialog).toHaveTextContent("You were not marked ready");
      expect(dialog).not.toHaveTextContent(/played/u);
    });

    it("stays out of the way of a reader with no check open", async () => {
      ready(runtime);
      runtime.live.store.setState({ games: [activeGame(GAME_ID, USER_ONE, USER_TWO)] });
      await openLobby(runtime);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("stays put when the seat was not taken", async () => {
    const user = userEvent.setup();
    ready(runtime);
    runtime.live.joinLobby.mockResolvedValue(rejectedCommand("game_not_waiting"));
    runtime.live.store.setState({ lobbies: [lobbyEntry(OTHER_GAME_ID, USER_TWO)] });
    await openLobby(runtime);

    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByText("Someone else took that seat first.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create a game or take a seat" })).toBeInTheDocument();
  });

  it("announces a command the server refused", async () => {
    const user = userEvent.setup();
    runtime.live.joinLobby.mockResolvedValue(rejectedCommand("game_not_waiting"));

    ready(runtime);
    runtime.live.store.setState({ lobbies: [lobbyEntry(OTHER_GAME_ID, USER_TWO)] });
    await openLobby(runtime);

    await user.click(screen.getByRole("button", { name: "Join" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That command was not confirmed");
    expect(alert).toHaveTextContent("Someone else took that seat first.");
  });

  it("does not claim a command was dropped when its answer went missing", async () => {
    const user = userEvent.setup();
    runtime.live.createLobby.mockResolvedValue({
      ok: false,
      requestId: GAME_ID,
      failure: "timed_out",
      code: null,
      message: null,
    });

    ready(runtime);
    await openLobby(runtime);
    await showNewGame();

    await user.click(screen.getByRole("button", { name: "Create game" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unknown/i);
    expect(alert).not.toHaveTextContent(/nothing was changed/i);
  });

  it("hides the previous user's snapshots until the socket names the new one", async () => {
    const switched = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_TWO }),
    });

    switched.live.store.setState({
      status: "ready",
      userId: USER_ONE.id,
      lobbies: [lobbyEntry(OTHER_GAME_ID, USER_ONE)],
      games: [activeGame(GAME_ID, USER_ONE, USER_TWO)],
      synced: true,
      lastRejection: { requestId: null, code: "invalid_message", message: "Malformed frame" },
    });

    await openLobby(switched);

    expect(screen.getByText("Connecting to the game server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New game" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
    expect(screen.queryByText("Their turn")).not.toBeInTheDocument();
    expect(screen.queryByText("Malformed frame")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Open rooms/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Your games/ })).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "You hold no seat right now. Open a lobby, or take one of the seats waiting above.",
      ),
    ).not.toBeInTheDocument();
  });

  it("does not render a separate panel for the viewer's game", async () => {
    ready(runtime);
    runtime.live.store.setState({ games: [activeGame(GAME_ID, USER_ONE, USER_TWO)] });
    await openLobby(runtime);

    expect(screen.queryByRole("region", { name: /Your games/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Your turn")).not.toBeInTheDocument();
  });

  it("surfaces a rejection the client could not match to a request", async () => {
    ready(runtime);
    runtime.live.store.setState({
      lastRejection: { requestId: null, code: "invalid_message", message: "Malformed frame" },
    });
    await openLobby(runtime);

    expect(await screen.findByRole("alert")).toHaveTextContent("Malformed frame");
  });

  describe("waiting for the opening sequence", () => {
    it("says the lists are still coming rather than showing an empty page", async () => {
      runtime.live.store.setState({ status: "ready", userId: USER_ONE.id, synced: false });
      await openLobby(runtime);

      expect(screen.getByText("Fetching open rooms…")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /Open rooms/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /Your games/ })).not.toBeInTheDocument();
    });

    it("shows the lists once the sequence has finished arriving", async () => {
      ready(runtime);
      runtime.live.store.setState({ lobbies: [lobbyEntry(OTHER_GAME_ID, USER_TWO)] });
      await openLobby(runtime);

      expect(screen.getByRole("region", { name: /Open rooms/ })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /Your games/ })).not.toBeInTheDocument();
    });
  });

  describe("what it does not offer", () => {
    const ABSENT = [
      /\bbot\b/i,
      /\bstake/i,
      /\byour side\b/i,
      /\bglicko/i,
      /\brematch\b/i,
      /\bspectat/i,
    ];

    it("says nothing about anything the server cannot do", async () => {
      ready(runtime);
      runtime.live.store.setState({
        lobbies: [lobbyEntry(OTHER_GAME_ID, USER_TWO)],
        games: [waitingGame()],
      });
      await openLobby(runtime);

      const main = screen.getByRole("main").textContent ?? "";
      for (const pattern of ABSENT) {
        expect(main).not.toMatch(pattern);
      }
    });

    it("offers a seat, stakes, and a clock typed in, not chosen from a list", async () => {
      ready(runtime);
      await openLobby(runtime);

      expect(screen.queryByRole("radio", { name: "Player 1" })).not.toBeInTheDocument();
      await showNewGame();

      const dialog = within(screen.getByRole("dialog", { name: "New game" }));
      const choices = dialog.getAllByRole("radio");
      expect(choices.map((choice) => choice.closest("label")?.textContent)).toStrictEqual([
        "Player 1",
        "Player 2",
        "Casual",
        "Rated",
      ]);

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "No clock" })).not.toBeChecked();
      expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });

    it("opens a casual game on the default clock, from the first seat", async () => {
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await userEvent.click(screen.getByRole("button", { name: "Create game" }));

      expect(runtime.live.createLobby).toHaveBeenCalledWith(
        false,
        { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
        PLAYER_ONE,
      );
    });

    it("opens a lobby for the second seat when that is the one asked for", async () => {
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await userEvent.click(screen.getByRole("radio", { name: "Player 2" }));
      await userEvent.click(screen.getByRole("button", { name: "Create game" }));

      expect(runtime.live.createLobby).toHaveBeenCalledWith(
        false,
        { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
        PLAYER_TWO,
      );
    });

    it("submits the durations that were typed in", async () => {
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await userEvent.clear(screen.getByLabelText("Minutes"));
      await userEvent.type(screen.getByLabelText("Minutes"), "2");
      await userEvent.clear(screen.getByLabelText("Seconds"));
      await userEvent.type(screen.getByLabelText("Seconds"), "30");
      await userEvent.clear(screen.getByLabelText("Increment (sec)"));
      await userEvent.type(screen.getByLabelText("Increment (sec)"), "1");
      await userEvent.click(screen.getByRole("button", { name: "Create game" }));

      expect(runtime.live.createLobby).toHaveBeenCalledWith(
        false,
        { kind: "timed", initialMs: 150_000, incrementMs: 1_000 },
        PLAYER_ONE,
      );
    });

    it("fills the boxes from a shortcut without making it a separate choice", async () => {
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await userEvent.click(screen.getByRole("button", { name: "3 + 2" }));

      expect(screen.getByLabelText("Minutes")).toHaveValue("3");
      expect(screen.getByLabelText("Increment (sec)")).toHaveValue("2");

      await userEvent.click(screen.getByRole("button", { name: "Create game" }));
      expect(runtime.live.createLobby).toHaveBeenCalledWith(
        false,
        { kind: "timed", initialMs: 180_000, incrementMs: 2_000 },
        PLAYER_ONE,
      );
    });

    it("refuses a clock too short to play, and points at the box that says so", async () => {
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await userEvent.clear(screen.getByLabelText("Minutes"));
      await userEvent.type(screen.getByLabelText("Minutes"), "0");
      await userEvent.clear(screen.getByLabelText("Seconds"));
      await userEvent.type(screen.getByLabelText("Seconds"), "5");
      await userEvent.click(screen.getByRole("button", { name: "Create game" }));

      expect(runtime.live.createLobby).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Seconds")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Seconds")).toHaveFocus();
    });

    it("turns a rated game with no clock into one with a clock", async () => {
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await userEvent.click(screen.getByRole("checkbox", { name: "No clock" }));
      await userEvent.click(screen.getByRole("radio", { name: "Rated" }));

      expect(screen.getByRole("checkbox", { name: "No clock" })).not.toBeChecked();
      expect(screen.getByRole("status")).toHaveTextContent(/Rated games need a clock/u);

      await userEvent.click(screen.getByRole("button", { name: "Create game" }));
      expect(runtime.live.createLobby).toHaveBeenCalledWith(
        true,
        { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
        PLAYER_ONE,
      );
    });

    it("turns a clockless game rated into a casual one", async () => {
      ready(runtime);
      runtime.live.createLobby.mockResolvedValue(ACCEPTED);
      await openLobby(runtime);
      await showNewGame();

      await userEvent.click(screen.getByRole("radio", { name: "Rated" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "No clock" }));

      expect(screen.getByRole("radio", { name: "Casual" })).toBeChecked();
      expect(screen.getByRole("status")).toHaveTextContent(/cannot be rated/u);

      await userEvent.click(screen.getByRole("button", { name: "Create game" }));
      expect(runtime.live.createLobby).toHaveBeenCalledWith(false, UNTIMED, PLAYER_ONE);
    });

    it("has no disabled placeholder standing in for a missing feature", async () => {
      ready(runtime);
      await openLobby(runtime);

      for (const control of screen.getAllByRole("button")) {
        expect(control).not.toBeDisabled();
      }
    });
  });
});
