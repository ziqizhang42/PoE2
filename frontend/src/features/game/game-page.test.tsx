import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthUser, GameSnapshot } from "@poe2/protocol";
import { PLAYER_TWO } from "@poe2/rules";

import { gamePath } from "../../app/routes.ts";
import { GamesRequestError } from "../../games/errors.ts";
import {
  ACCEPTED,
  activeGame,
  createFakeAuthClient,
  createTestRuntime,
  finishedGame,
  GAME_ID,
  gameReplay,
  historyEntry,
  historyPage,
  OTHER_GAME_ID,
  playedGame,
  readyCheckGame,
  rejectedCommand,
  USER_ONE,
  USER_TWO,
  timedActiveGame,
  waitingGame,
  type TestRuntime,
} from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";
import { TABLE_SCROLL } from "../../ui/classes.ts";

/** P1: d4/d6; P2: a1/a2; P1 to move. */
const MIDGAME = ["d4", "a1", "d6", "a2"];

function signedIn(user: AuthUser = USER_ONE): TestRuntime {
  return createTestRuntime({
    authClient: createFakeAuthClient({ fetchSession: async () => user }),
  });
}

function holding(runtime: TestRuntime, game: GameSnapshot, user: AuthUser = USER_ONE): void {
  runtime.live.store.setState({
    status: "ready",
    userId: user.id,
    games: [game],
    gameReceivedAtMs: { [game.id]: runtime.clock.now() },
    synced: true,
  });
}

async function openGame(runtime: TestRuntime): Promise<void> {
  renderApp(runtime, gamePath(GAME_ID));
  await screen.findByRole("grid");
}

function cell(notation: string): HTMLElement {
  return screen.getByRole("gridcell", { name: new RegExp(`^${notation},`) });
}

describe("GamePage", () => {
  let runtime: TestRuntime;

  beforeEach(() => {
    runtime = signedIn();
  });

  describe("who may look at it", () => {
    it("sends a signed-out visitor to sign in", async () => {
      const signedOut = createTestRuntime();
      renderApp(signedOut, gamePath(GAME_ID));

      expect(await screen.findByRole("form", { name: "Credentials" })).toBeInTheDocument();
    });

    it("withholds a game the socket has not yet claimed for this account", async () => {
      const switched = signedIn(USER_TWO);
      switched.live.store.setState({
        status: "ready",
        userId: USER_ONE.id,
        games: [activeGame()],
        synced: true,
      });

      renderApp(switched, gamePath(GAME_ID));

      expect(await screen.findByText("Connecting to the game server")).toBeInTheDocument();
      expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    });

    it("offers no spectator view to someone holding no seat", async () => {
      const stranger: AuthUser = { id: "0f0f0f0f-0000-4000-8000-000000000000", username: "Nobody" };
      const outsider = signedIn(stranger);
      holding(outsider, activeGame(), stranger);

      renderApp(outsider, gamePath(GAME_ID));

      expect(await screen.findByText("You hold no seat in this game")).toBeInTheDocument();
      expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    });
  });

  describe("before the game is in hand", () => {
    it("keeps waiting while the opening snapshots may still be arriving", async () => {
      runtime.live.store.setState({
        status: "ready",
        userId: USER_ONE.id,
        games: [],
        synced: false,
      });
      renderApp(runtime, gamePath(GAME_ID));

      expect(
        await screen.findByText("Still synchronizing with the game server…"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/not one of your open games/)).not.toBeInTheDocument();
    });

    it("rules the game out only once the server says the opening state is complete", async () => {
      runtime.live.store.setState({
        status: "ready",
        userId: USER_ONE.id,
        games: [],
        synced: false,
      });
      renderApp(runtime, gamePath(GAME_ID));
      await screen.findByText("Still synchronizing with the game server…");

      runtime.live.store.setState({ synced: true });

      expect(
        await screen.findByText("This game is not one of your open games"),
      ).toBeInTheDocument();
    });

    it("reports an archive failure and retries instead of calling the game absent", async () => {
      runtime.gamesClient.fetchReplay
        .mockRejectedValueOnce(
          new GamesRequestError({
            kind: "network",
            message: "Could not reach the server.",
            status: null,
            code: null,
          }),
        )
        .mockResolvedValueOnce(gameReplay(["d4"]));
      runtime.live.store.setState({
        status: "ready",
        userId: USER_ONE.id,
        games: [],
        synced: true,
      });
      renderApp(runtime, gamePath(GAME_ID));

      expect(
        await screen.findByRole("heading", { name: "That game record could not be checked" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("This game is not one of your open games")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/beat/u);
      expect(runtime.gamesClient.fetchReplay).toHaveBeenCalledTimes(2);
    });

    it("shows a game that arrives after the connection turned ready", async () => {
      runtime.live.store.setState({
        status: "ready",
        userId: USER_ONE.id,
        games: [],
        synced: false,
      });
      renderApp(runtime, gamePath(GAME_ID));
      await screen.findByText("Still synchronizing with the game server…");

      runtime.live.store.setState({ games: [activeGame()], synced: true });

      expect(await screen.findByRole("grid")).toBeInTheDocument();
    });

    it("blames the connection rather than the game when the socket is down", async () => {
      runtime.live.store.setState({
        status: "disconnected",
        userId: USER_ONE.id,
        games: [],
        synced: false,
      });
      renderApp(runtime, gamePath(GAME_ID));

      expect(await within(screen.getByRole("main")).findByText("Disconnected")).toBeInTheDocument();
      expect(screen.queryByText(/not one of your open games/)).not.toBeInTheDocument();
    });
  });

  describe("the states a game can be in", () => {
    it("says a waiting game has nobody to play against yet", async () => {
      holding(runtime, waitingGame());
      await openGame(runtime);

      expect(screen.getByText("Waiting for a second player")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Score" })).not.toBeInTheDocument();
      expect(cell("d4")).toHaveAttribute("aria-disabled", "true");
    });

    it("labels a waiting creator by creatorSeat and shows a timed lobby's balances", async () => {
      const game = {
        ...waitingGame(undefined, USER_ONE, PLAYER_TWO),
        timeControl: { kind: "timed", initialMs: 180_000, incrementMs: 2_000 } as const,
      };
      holding(runtime, game);
      await openGame(runtime);

      expect(screen.getByText("You are Player 2")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        `an open seat vs ${USER_ONE.username}`,
      );
      expect(
        within(screen.getByRole("region", { name: "Score" })).getAllByText("3:00"),
      ).toHaveLength(2);
    });

    it("spends time since an active snapshot arrived before the screen mounted", async () => {
      holding(runtime, timedActiveGame());
      runtime.clock.advance(20_000);

      await openGame(runtime);

      const readout = within(screen.getByRole("region", { name: "Score" }));
      expect(readout.getByText("4:40")).toBeInTheDocument();
      expect(readout.getByText("5:00")).toBeInTheDocument();
    });

    it("says both players are here but nothing has started", async () => {
      holding(runtime, readyCheckGame());
      await openGame(runtime);

      expect(screen.getByText("Both players are here")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Ready to play?" })).toBeInTheDocument();
      expect(cell("d4")).toHaveAttribute("aria-disabled", "true");
      expect(screen.queryByRole("button", { name: "Resign" })).not.toBeInTheDocument();
    });

    it("says each seat's answer in words rather than in ticks", async () => {
      holding(runtime, readyCheckGame({ playerTwoReady: true }));
      await openGame(runtime);

      expect(screen.getAllByText("Ready")).toHaveLength(1);
      expect(screen.getAllByText("Not confirmed yet")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "I'm ready" })).toBeEnabled();
    });

    it("confirms with one command and does not resend once confirmed", async () => {
      holding(runtime, readyCheckGame());
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "I'm ready" }));

      expect(runtime.live.readyGame).toHaveBeenCalledTimes(1);
      expect(runtime.live.readyGame).toHaveBeenCalledWith({
        gameId: GAME_ID,
        readyCheckGeneration: 1,
      });
    });

    it("leaves the check without conceding anything", async () => {
      holding(runtime, readyCheckGame());
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Leave" }));

      expect(runtime.live.declineGame).toHaveBeenCalledWith({
        gameId: GAME_ID,
        readyCheckGeneration: 1,
      });
      expect(runtime.live.resignGame).not.toHaveBeenCalled();
    });

    it("counts the check down against the injected clock", async () => {
      holding(runtime, readyCheckGame());
      await openGame(runtime);

      const panel = screen.getByRole("dialog", { name: "Ready to play?" });
      expect(panel.textContent).toContain("60 seconds left");

      runtime.clock.advance(10_000);
      runtime.clock.fire();

      await waitFor(() => {
        expect(panel.textContent).toContain("50 seconds left");
      });
    });

    it("reads an active game from Player 1's seat", async () => {
      holding(runtime, activeGame());
      await openGame(runtime);

      expect(screen.getByText("Your turn")).toBeInTheDocument();
      expect(screen.getByText("You are Player 1")).toBeInTheDocument();
      expect(cell("a1")).toHaveAccessibleName("a1, empty, worth 1 point");
    });

    it("reads the same game from Player 2's seat", async () => {
      const second = signedIn(USER_TWO);
      holding(second, playedGame(["d4"]), USER_TWO);
      await openGame(second);

      expect(screen.getByText("Your turn")).toBeInTheDocument();
      expect(screen.getByText("You are Player 2")).toBeInTheDocument();
      expect(cell("d4")).toHaveAccessibleName("d4, player 1, theirs, last move");
    });

    it("waits its turn without offering a move", async () => {
      holding(runtime, playedGame(["d4"]));
      await openGame(runtime);

      expect(screen.getByText("Their turn")).toBeInTheDocument();
      expect(cell("e5")).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText("It is not your turn.")).toBeInTheDocument();
    });

    it("reports the result, the totals and the handicap when the board is full", async () => {
      holding(runtime, finishedGame());
      await openGame(runtime);

      expect(screen.getByText("You won by 34½")).toBeInTheDocument();
      expect(screen.queryByText("+34½")).not.toBeInTheDocument();
      expect(screen.getByText("208")).toBeInTheDocument();
      expect(screen.getByText("173½")).toBeInTheDocument();
      expect(screen.getByText("168 + 5½")).toBeInTheDocument();
      expect(screen.getByText("49 played")).toBeInTheDocument();
      expect(cell("a1")).toHaveAttribute("aria-disabled", "true");
    });

    it("keeps outcome prose out of the player score panel", async () => {
      holding(runtime, playedGame(MIDGAME, { resignedBy: 1 }));
      await openGame(runtime);

      const readout = within(screen.getByRole("region", { name: "Score" }));
      expect(readout.queryByText(/ahead/u)).not.toBeInTheDocument();
      expect(readout.queryByText(/board full/u)).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: /Who leads/u })).not.toHaveAccessibleName(
        /finished ahead|board full/u,
      );
    });

    it("shows where each player's score comes from, by run length", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      const ladder = within(screen.getByRole("region", { name: /Exponent ladder/ }));
      const runsOfTwo = ladder.getByRole("row", { name: /^2 2 long/ });
      expect(within(runsOfTwo).getAllByRole("cell").at(-1)).toHaveTextContent("1");

      const alone = ladder.getByRole("row", { name: /alone/ });
      expect(within(alone).getAllByRole("cell").at(1)).toHaveTextContent("2");
      expect(within(alone).getAllByRole("cell").at(2)).toHaveTextContent("0");
      expect(ladder.getByText("1 scoring")).toBeInTheDocument();
    });

    it("names the run values as row headers, so no rung depends on its bar", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      const ladder = within(screen.getByRole("region", { name: /Exponent ladder/ }));
      expect(ladder.getByRole("rowheader", { name: "64" })).toBeInTheDocument();
      expect(ladder.getByRole("rowheader", { name: "1" })).toBeInTheDocument();
      expect(ladder.getByRole("columnheader", { name: "Player 1" })).toBeInTheDocument();
    });

    it("draws the lead after each move, and says it in its label", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      const strip = screen.getByRole("img", { name: /Who leads after each move/ });
      expect(strip).toHaveAccessibleName(/after move 4/);
    });

    it("leaves margin narration to the lead strip", async () => {
      const game = finishedGame();
      holding(runtime, game);
      await openGame(runtime);

      const readout = within(screen.getByRole("region", { name: "Score" }));
      expect(readout.queryByText("+34½")).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: /Who leads/ })).toHaveAccessibleName(/34½/);
    });

    it("offers no lead strip before there is a game to have led in", async () => {
      holding(runtime, waitingGame());
      await openGame(runtime);

      expect(screen.queryByRole("img", { name: /Who leads/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /Exponent ladder/ })).not.toBeInTheDocument();
    });

    it("lists the moves in square notation, one turn per row", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      const history = within(screen.getByRole("region", { name: /Moves/ }));
      expect(history.getByRole("cell", { name: "d4" })).toBeInTheDocument();
      expect(history.getByRole("cell", { name: "a2" })).toBeInTheDocument();
      expect(history.getByRole("columnheader", { name: "Player 2" })).toBeInTheDocument();
    });

    it("keeps a wide table inside its own scrolling card", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      const history = within(screen.getByRole("region", { name: /Moves/ }));
      expect(history.getByRole("table").parentElement?.className).toContain(TABLE_SCROLL);
    });
  });

  describe("the result when a game ends", () => {
    it("says who won, by how much and why, without waiting for a rating", async () => {
      holding(runtime, finishedGame());
      await openGame(runtime);

      const result = within(screen.getByRole("dialog", { name: "You won" }));
      expect(result.getByText("by 34\u00bd")).toBeInTheDocument();
      expect(result.getByText(/board filled after 49 moves/)).toBeInTheDocument();
    });

    it("says a casual game moved nobody's rating, and asks for none", async () => {
      holding(runtime, finishedGame());
      await openGame(runtime);

      const result = within(screen.getByRole("dialog", { name: "You won" }));
      expect(result.getByText(/nobody.s rating moved/)).toBeInTheDocument();
      expect(runtime.playersClient.fetchGames).not.toHaveBeenCalled();
    });

    it("draws a rated game's rating move from the ledger, in both directions", async () => {
      runtime.playersClient.fetchGames.mockResolvedValue(
        historyPage([
          historyEntry({
            rated: true,
            ratingChange: { before: 1499.7918736952836, after: 1512.483354047153 },
          }),
        ]),
      );
      holding(runtime, { ...finishedGame(), rated: true });
      await openGame(runtime);

      const result = within(await screen.findByRole("dialog", { name: "You won" }));
      expect(await result.findByText("1500")).toBeInTheDocument();
      expect(result.getByText("1512")).toBeInTheDocument();
      expect(result.getByText("+12")).toBeInTheDocument();
      expect(runtime.playersClient.fetchGames).toHaveBeenCalledWith(
        USER_ONE.username,
        expect.objectContaining({ limit: 50 }),
      );
    });

    it("pages until it finds an older rated result", async () => {
      runtime.playersClient.fetchGames
        .mockResolvedValueOnce(
          historyPage([historyEntry({ gameId: OTHER_GAME_ID })], {
            nextCursor: "older-games",
          }),
        )
        .mockResolvedValueOnce(
          historyPage([
            historyEntry({
              rated: true,
              ratingChange: { before: 1500, after: 1516 },
            }),
          ]),
        );
      holding(runtime, { ...finishedGame(), rated: true });
      await openGame(runtime);

      const result = within(await screen.findByRole("dialog", { name: "You won" }));
      expect(await result.findByText("+16")).toBeInTheDocument();
      expect(runtime.playersClient.fetchGames).toHaveBeenNthCalledWith(
        2,
        USER_ONE.username,
        expect.objectContaining({ cursor: "older-games", limit: 50 }),
      );
    });

    it("closes to the final board, and stays closed", async () => {
      holding(runtime, finishedGame());
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(screen.getByText("You won by 34\u00bd")).toBeInTheDocument();
    });
  });

  describe("what the board draws", () => {
    it("shows both aids and offers the switches in a casual game", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      expect(cell("a3")).toHaveAccessibleName(/worth/u);
      expect(screen.getByRole("switch", { name: "Run values" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "Square gains" })).toBeChecked();
    });

    it("takes the gain out of the square's name as well as off the board", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      await userEvent.click(screen.getByRole("switch", { name: "Square gains" }));

      expect(cell("a3")).toHaveAccessibleName("a3, empty");
      expect(screen.getByRole("switch", { name: "Square gains" })).not.toBeChecked();
    });

    it("keeps the choice when the board repaints", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      await userEvent.click(screen.getByRole("switch", { name: "Square gains" }));
      holding(runtime, playedGame([...MIDGAME, "g7"]));

      await waitFor(() => {
        expect(cell("a3")).toHaveAccessibleName("a3, empty");
      });
    });

    it("shows neither aid in a rated game, and offers no switches", async () => {
      const rated = { ...playedGame(MIDGAME), rated: true };
      holding(runtime, rated);
      await openGame(runtime);

      expect(cell("a3")).toHaveAccessibleName("a3, empty");
      expect(screen.queryByRole("switch", { name: "Run values" })).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "Square gains" })).not.toBeInTheDocument();
    });
  });

  describe("playing a move", () => {
    beforeEach(() => {
      holding(runtime, playedGame(MIDGAME));
    });

    it("prices every empty square from the rules, not from a guess", async () => {
      await openGame(runtime);

      expect(cell("d5")).toHaveAccessibleName("d5, empty, worth 2 points");
      expect(cell("g7")).toHaveAccessibleName("g7, empty, worth 1 point");
    });

    it("sends the square and the revision it is acting on, once", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      await user.click(cell("d5"));

      expect(runtime.live.playMove).toHaveBeenCalledTimes(1);
      expect(runtime.live.playMove).toHaveBeenCalledWith({
        gameId: GAME_ID,
        expectedRevision: 5,
        square: { row: 4, col: 3 },
      });
    });

    it("refuses to send anything for a square that already holds a piece", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      expect(cell("d4")).toHaveAttribute("aria-disabled", "true");
      await user.click(cell("d4"));

      expect(runtime.live.playMove).not.toHaveBeenCalled();
    });

    it("draws a move in flight as sent, never as played", async () => {
      const user = userEvent.setup();
      runtime.live.playMove.mockImplementation(() => new Promise(() => {}));
      await openGame(runtime);

      await user.click(cell("d5"));

      const pending = await screen.findByRole("gridcell", {
        name: "d5, your move is being sent",
      });
      expect(pending).toBeInTheDocument();
      expect(pending).toHaveTextContent("");
      expect(screen.queryByRole("gridcell", { name: /^d5, player/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole("gridcell", { name: /, player \d, / })).toHaveLength(4);
    });

    it("stops drawing the outline once a snapshot occupies that square", async () => {
      const user = userEvent.setup();
      runtime.live.playMove.mockImplementation(() => new Promise(() => {}));
      await openGame(runtime);

      await user.click(cell("d5"));
      await screen.findByRole("gridcell", { name: "d5, your move is being sent" });

      runtime.live.store.setState({ games: [playedGame([...MIDGAME, "d5"])] });

      expect(await screen.findByRole("gridcell", { name: /^d5, player 1/ })).toBeInTheDocument();
      expect(
        screen.queryByRole("gridcell", { name: "d5, your move is being sent" }),
      ).not.toBeInTheDocument();
    });

    it("drops a second move while one is still unanswered", async () => {
      const user = userEvent.setup();
      runtime.live.playMove.mockImplementation(() => new Promise(() => {}));
      await openGame(runtime);

      await user.click(cell("d5"));
      await screen.findByText("Waiting for the server to confirm your move.");
      await user.click(cell("e5"));

      expect(runtime.live.playMove).toHaveBeenCalledTimes(1);
    });

    it("says a refused move was not played", async () => {
      const user = userEvent.setup();
      runtime.live.playMove.mockResolvedValue(rejectedCommand("occupied"));
      await openGame(runtime);

      await user.click(cell("d5"));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("That move was not confirmed");
      expect(alert).toHaveTextContent("That square was taken before your move arrived");
    });

    it("leaves a lost answer unknown rather than claiming the move was dropped", async () => {
      const user = userEvent.setup();
      runtime.live.playMove.mockResolvedValue({
        ok: false,
        requestId: GAME_ID,
        failure: "timed_out",
        code: null,
        message: null,
      });
      await openGame(runtime);

      await user.click(cell("d5"));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/unknown/i);
      expect(alert).not.toHaveTextContent(/nothing was played/i);
    });

    it("stops taking moves while the connection is away, and keeps the board", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      runtime.live.store.setState({ status: "reconnecting", reconnectAttempts: 2 });

      expect(await within(screen.getByRole("main")).findByText("Reconnecting")).toBeInTheDocument();
      expect(screen.getByRole("grid")).toBeInTheDocument();
      expect(cell("d5")).toHaveAttribute("aria-disabled", "true");

      await user.click(cell("d5"));
      expect(runtime.live.playMove).not.toHaveBeenCalled();
    });
  });

  describe("Player 2 at the board", () => {
    it("draws its own move in flight in its own colours", async () => {
      const user = userEvent.setup();
      const second = signedIn(USER_TWO);
      second.live.playMove.mockImplementation(() => new Promise(() => {}));
      holding(second, playedGame(["d4"]), USER_TWO);
      await openGame(second);

      await user.click(cell("e5"));

      const marker = (
        await screen.findByRole("gridcell", { name: "e5, your move is being sent" })
      ).querySelector("span.border-dashed");

      expect(marker?.className).toContain("border-pen-2");
      expect(marker?.className).not.toContain("border-pen-1");
      expect(marker).toHaveTextContent("");
    });

    it("sends its move with the snapshot's revision like Player 1 does", async () => {
      const user = userEvent.setup();
      const second = signedIn(USER_TWO);
      holding(second, playedGame(["d4"]), USER_TWO);
      await openGame(second);

      await user.click(cell("e5"));

      expect(second.live.playMove).toHaveBeenCalledWith({
        gameId: GAME_ID,
        expectedRevision: 2,
        square: { row: 4, col: 4 },
      });
    });
  });

  describe("the keyboard", () => {
    beforeEach(() => {
      holding(runtime, playedGame(MIDGAME));
    });

    it("holds one tab stop, on the last move", async () => {
      await openGame(runtime);

      expect(cell("a2")).toHaveAttribute("tabindex", "0");
      expect(cell("d5")).toHaveAttribute("tabindex", "-1");
    });

    it("walks the board with the arrow keys, up meaning a higher rank", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      cell("a2").focus();
      await user.keyboard("{ArrowUp}");
      expect(document.activeElement).toHaveAttribute("data-square", "a3");

      await user.keyboard("{ArrowRight}{ArrowRight}");
      expect(document.activeElement).toHaveAttribute("data-square", "c3");

      await user.keyboard("{ArrowDown}{ArrowDown}");
      expect(document.activeElement).toHaveAttribute("data-square", "c1");
    });

    it("stops at the edge instead of wrapping round", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      cell("a2").focus();
      await user.keyboard("{ArrowLeft}");

      expect(document.activeElement).toHaveAttribute("data-square", "a2");
    });

    it("claims every navigation key, so the page never scrolls underneath", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      const prevented: Record<string, boolean> = {};
      const listener = (event: KeyboardEvent): void => {
        prevented[event.key] = event.defaultPrevented;
      };
      document.addEventListener("keydown", listener);

      try {
        cell("a1").focus();
        await user.keyboard("{ArrowLeft}{ArrowDown}{Home}");

        expect(prevented).toStrictEqual({ ArrowLeft: true, ArrowDown: true, Home: true });

        await user.keyboard("{Tab}");
        expect(prevented["Tab"]).toBe(false);
      } finally {
        document.removeEventListener("keydown", listener);
      }
    });

    it("jumps to the ends of a rank", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      cell("a2").focus();
      await user.keyboard("{End}");
      expect(document.activeElement).toHaveAttribute("data-square", "g2");

      await user.keyboard("{Home}");
      expect(document.activeElement).toHaveAttribute("data-square", "a2");
    });

    it("moves the tab stop to wherever focus actually went", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      cell("a2").focus();
      await user.keyboard("{ArrowUp}");

      await waitFor(() => {
        expect(cell("a3")).toHaveAttribute("tabindex", "0");
      });
      expect(cell("a2")).toHaveAttribute("tabindex", "-1");
    });

    it("plays the focused square on Enter", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      cell("d5").focus();
      await user.keyboard("{Enter}");

      expect(runtime.live.playMove).toHaveBeenCalledWith({
        gameId: GAME_ID,
        expectedRevision: 5,
        square: { row: 4, col: 3 },
      });
    });

    it("keeps focus where it was when a snapshot arrives", async () => {
      const user = userEvent.setup();
      await openGame(runtime);

      cell("d5").focus();
      await user.keyboard("{ArrowUp}");
      expect(document.activeElement).toHaveAttribute("data-square", "d6");

      runtime.live.store.setState({ games: [playedGame([...MIDGAME, "g7"])] });

      await screen.findByText("Their turn");
      expect(document.activeElement).toHaveAttribute("data-square", "d6");
    });
  });

  describe("resigning", () => {
    it("asks before it does anything", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Resign" }));

      expect(screen.getByText("Resign this game?")).toBeInTheDocument();
      expect(runtime.live.resignGame).not.toHaveBeenCalled();
    });

    it("moves focus to the answer, so a keyboard reader is not left nowhere", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Resign" }));

      expect(screen.getByRole("button", { name: "Yes, resign" })).toHaveFocus();
    });

    it("sends exactly one command, with the revision on screen", async () => {
      const game = playedGame(MIDGAME);
      holding(runtime, game);
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Resign" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, resign" }));

      expect(runtime.live.resignGame).toHaveBeenCalledTimes(1);
      expect(runtime.live.resignGame).toHaveBeenCalledWith({
        gameId: game.id,
        expectedRevision: game.revision,
      });
    });

    it("backs out on Escape without sending anything", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Resign" }));
      await userEvent.keyboard("{Escape}");

      expect(screen.getByRole("button", { name: "Resign" })).toBeInTheDocument();
      expect(runtime.live.resignGame).not.toHaveBeenCalled();
    });

    it("backs out when asked to keep playing", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Resign" }));
      await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));

      expect(screen.getByRole("button", { name: "Resign" })).toBeInTheDocument();
      expect(runtime.live.resignGame).not.toHaveBeenCalled();
    });

    it("is not offered on a game nobody can move in", async () => {
      holding(runtime, finishedGame());
      await openGame(runtime);

      expect(screen.queryByRole("button", { name: "Resign" })).not.toBeInTheDocument();
    });

    it("cannot be used while the connection is away", async () => {
      holding(runtime, playedGame(MIDGAME));
      runtime.live.store.setState({ status: "reconnecting" });
      await openGame(runtime);

      expect(screen.getByRole("button", { name: "Resign" })).toBeDisabled();
    });

    it("reports a refusal rather than assuming the game ended", async () => {
      holding(runtime, playedGame(MIDGAME));
      runtime.live.resignGame.mockResolvedValue(rejectedCommand("stale_game"));
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Resign" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, resign" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("That resignation was not confirmed");
      expect(alert).toHaveTextContent(/had already moved on/u);
      expect(alert).not.toHaveTextContent(/move was not played/u);
    });
  });

  describe("withdrawing a lobby you opened", () => {
    it("withdraws and returns the reader to the lobby", async () => {
      runtime.live.cancelLobby.mockResolvedValue(ACCEPTED);
      holding(runtime, waitingGame());
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Withdraw this lobby" }));

      expect(runtime.live.cancelLobby).toHaveBeenCalledWith(GAME_ID);
      expect(
        await screen.findByRole("heading", { name: "Open a seat, or take one" }),
      ).toBeInTheDocument();
    });

    it("is absent once there is a game rather than a seat", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      expect(screen.queryByRole("button", { name: "Withdraw this lobby" })).not.toBeInTheDocument();
    });

    it("describes a refused withdrawal as a withdrawal", async () => {
      runtime.live.cancelLobby.mockResolvedValue(rejectedCommand("rate_limited"));
      holding(runtime, waitingGame());
      await openGame(runtime);

      await userEvent.click(screen.getByRole("button", { name: "Withdraw this lobby" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("That lobby withdrawal was not confirmed");
      expect(alert).toHaveTextContent("The lobby was not withdrawn");
      expect(alert).not.toHaveTextContent(/played/u);
    });
  });

  describe("what it does not offer", () => {
    // Word boundaries avoid matching ordinary explanatory prose.
    const ABSENT = [
      /\brematch/i,
      /\bplay again\b/i,
      /\bspectator\b/i,
      /\bbot\b/i,
      /\bstake/i,
      /\bglicko/i,
    ];

    it("has no control for anything the server cannot do", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("link")]) {
        for (const pattern of ABSENT) {
          expect(control.textContent ?? "").not.toMatch(pattern);
        }
      }
    });

    it("says nothing about a bot or rematch when a game ends", async () => {
      holding(runtime, finishedGame());
      await openGame(runtime);

      const main = screen.getByRole("main").textContent ?? "";
      for (const pattern of ABSENT) {
        expect(main).not.toMatch(pattern);
      }
    });

    it("offers only the board and the way back to the lobby", async () => {
      holding(runtime, playedGame(MIDGAME));
      await openGame(runtime);

      const links = screen
        .getAllByRole("link")
        .map((link) => link.textContent)
        .filter((text): text is string => text !== null && text !== "");

      expect(links).toContain("Back to the lobby");
    });
  });
});
