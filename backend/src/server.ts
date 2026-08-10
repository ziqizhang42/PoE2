import console from "node:console";
import process from "node:process";

import { createKdfExecutor } from "./auth/kdf-executor.js";
import { createPasswordHasher } from "./auth/password.js";
import { createAuthRepository } from "./auth/repository.js";
import { createAuthService } from "./auth/service.js";
import { buildApp } from "./app.js";
import { readAuthConfig } from "./config/auth.js";
import { readDatabaseConfig } from "./config/database.js";
import { readDeadlineConfig } from "./config/deadline.js";
import { readKdfConfig } from "./config/kdf.js";
import { readRatingDecayConfig } from "./config/rating-decay.js";
import { readServerConfig } from "./config/server.js";
import { readWebSocketConfig } from "./config/websocket.js";
import { readWebSocketLimitsConfig } from "./config/ws-limits.js";
import { createDatabaseClient } from "./db/client.js";
import { installGracefulShutdown } from "./graceful-shutdown.js";
import { createDeadlineService } from "./game/deadline-service.js";
import { createHistoryReadLimiter } from "./limits/history-read-limiter.js";
import { systemClock, systemScheduler } from "./limits/clock.js";
import { createPlayerReadLimiter } from "./limits/player-read-limiter.js";
import { createWebSocketLimits } from "./limits/websocket-limits.js";
import { createRatingDecay } from "./rating/decay.js";
import { startRatingDecay } from "./rating/decay-supervisor.js";
import { createRatingLedger } from "./rating/ledger.js";
import { createGameRepository } from "./game/repository.js";
import { createGameService } from "./game/service.js";
import { createHistoryService } from "./game/history-service.js";
import { createRatingReader } from "./rating/reader.js";
import { authPlugin } from "./http/auth.js";
import { gamesPlugin } from "./http/games.js";
import { readinessPlugin } from "./http/health.js";
import { playersPlugin } from "./http/players.js";
import { createConnectionHub } from "./http/ws-hub.js";
import { registerWebSocket } from "./http/ws.js";
import { createPlayerRepository } from "./player/repository.js";
import type { GameService } from "./game/service.js";

/** Reads settings needed before Fastify, including its immutable trustProxy option. */
function readConfig(environment: Readonly<Record<string, string | undefined>>) {
  try {
    return {
      server: readServerConfig(environment),
      auth: readAuthConfig(environment),
      database: readDatabaseConfig(environment),
      kdf: readKdfConfig(environment),
      webSocket: readWebSocketConfig(environment),
      webSocketLimits: readWebSocketLimitsConfig(environment),
      deadline: readDeadlineConfig(environment),
      ratingDecay: readRatingDecayConfig(environment),
    };
  } catch (error) {
    console.error("invalid configuration", error);
    process.exit(1);
  }
}

const config = readConfig(process.env);

const app = buildApp({ logger: true, trustProxy: config.server.instance.trustProxy });
installGracefulShutdown(app);

try {
  const database = createDatabaseClient(config.database);
  app.register(readinessPlugin, { check: database.checkReady });
  const hasher = createPasswordHasher(createKdfExecutor(config.kdf));
  const authService = createAuthService(createAuthRepository(database.db), hasher, {
    onRecoveredError: (error) => {
      app.log.warn({ err: error }, "authentication recovered from a stored-credential problem");
    },
  });

  const ratingLedger = createRatingLedger({ periodMs: config.ratingDecay.periodMs });
  const wsLimits = createWebSocketLimits(config.webSocketLimits);
  const historyReadLimiter = createHistoryReadLimiter(config.webSocketLimits);
  const profileReadLimiter = createPlayerReadLimiter(config.webSocketLimits);
  const replayReadLimiter = createPlayerReadLimiter(config.webSocketLimits);
  const hub = createConnectionHub();

  // Finish and rating changes share the repository transaction.
  const gameRepository = createGameRepository(database.db, {
    onGameFinished: async (executor, game, finish) => {
      if (!game.rated || game.playerTwo === null) {
        return;
      }

      await ratingLedger.applyFinishedGame(executor, {
        gameId: game.id,
        playerOneId: game.playerOne.id,
        playerTwoId: game.playerTwo.id,
        winner: finish.winner,
      });
    },
  });

  let gameService: GameService;
  const deadlines = createDeadlineService({
    capacity: config.deadline.maxActiveGames,
    clock: systemClock,
    scheduler: systemScheduler,
    process: (gameId, expectedDeadline) => gameService.processDeadline(gameId, expectedDeadline),
    onFinished: (game) => {
      const message = { type: "game.snapshot" as const, game };
      hub.send(game.players.playerOne.id, message);
      if (game.players.playerTwo !== null) {
        hub.send(game.players.playerTwo.id, message);
      }
    },
    onAbandoned: async (game, releasedPlayerId) => {
      // The reopened snapshot omits the released player, who instead gets closed.
      hub.send(game.players.playerOne.id, { type: "game.snapshot", game });
      hub.send(releasedPlayerId, { type: "game.closed", gameId: game.id });
      hub.broadcast({
        type: "lobby.snapshot",
        lobbies: await gameService.listWaitingLobbies(),
      });
    },
    onError: (error) => {
      app.log.error({ err: error }, "deadline supervision failed");
    },
  });
  gameService = createGameService(gameRepository, deadlines);

  // Register cleanup before recovery reads that may fail after starting timers.
  const ratingDecay = startRatingDecay({
    decay: createRatingDecay(database.db, {
      periodMs: config.ratingDecay.periodMs,
      batchSize: config.ratingDecay.batchSize,
    }),
    sweepMs: config.ratingDecay.sweepMs,
    scheduler: systemScheduler,
    onError: (error) => {
      app.log.error({ err: error }, "rating decay pass failed");
    },
    onPass: (decayed) => {
      app.log.info({ decayed }, "rating decay applied");
    },
  });

  app.addHook("onClose", async () => {
    deadlines.stop();
    ratingDecay.stop();
    await database.close();
  });

  // Capacity + 1 detects an unsafe overflow without loading every deadline.
  const restoredDeadlines = await gameRepository.listPendingDeadlines(
    config.deadline.maxActiveGames + 1,
  );
  deadlines.restore(restoredDeadlines);
  app.register(authPlugin, {
    ...config.auth,
    service: authService,
  });

  const historyService = createHistoryService(gameRepository, createRatingReader(database.db));

  app.register(gamesPlugin, {
    historyService,
    readLimiter: replayReadLimiter,
  });

  app.register(playersPlugin, {
    repository: createPlayerRepository(database.db),
    historyService,
    readLimiter: profileReadLimiter,
    // History reads are costlier than aggregate profile reads.
    historyLimiter: historyReadLimiter,
  });

  await registerWebSocket(app, {
    ...config.auth,
    ...config.webSocket,
    authService,
    gameService,
    hub,
    // In-memory budgets reset on process restart.
    limits: wsLimits,
  });

  await app.listen(config.server.listen);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
