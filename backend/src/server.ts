import console from "node:console";
import process from "node:process";

import { createKdfExecutor } from "./auth/kdf-executor.js";
import { createPasswordHasher } from "./auth/password.js";
import { createAuthRepository } from "./auth/repository.js";
import { createAuthService } from "./auth/service.js";
import { buildApp } from "./app.js";
import { readAuthConfig } from "./config/auth.js";
import { readDatabaseConfig } from "./config/database.js";
import { readKdfConfig } from "./config/kdf.js";
import { readServerConfig } from "./config/server.js";
import { createDatabaseClient } from "./db/client.js";
import { authPlugin } from "./http/auth.js";

/**
 * The whole environment is validated up front, before anything is constructed.
 *
 * This cannot run inside the bootstrap below: `trustProxy` is fixed when the
 * Fastify instance is constructed, so there is no logger yet to report a
 * configuration fault with.
 */
function readConfig(environment: Readonly<Record<string, string | undefined>>) {
  try {
    return {
      server: readServerConfig(environment),
      auth: readAuthConfig(environment),
      database: readDatabaseConfig(environment),
      kdf: readKdfConfig(environment),
    };
  } catch (error) {
    console.error("invalid configuration", error);
    process.exit(1);
  }
}

const config = readConfig(process.env);

const app = buildApp({ logger: true, trustProxy: config.server.instance.trustProxy });

try {
  const database = createDatabaseClient(config.database);
  const hasher = createPasswordHasher(createKdfExecutor(config.kdf));
  const authService = createAuthService(createAuthRepository(database.db), hasher, {
    onRecoveredError: (error) => {
      app.log.warn({ err: error }, "authentication recovered from a stored-credential problem");
    },
  });

  app.addHook("onClose", () => database.close());
  app.register(authPlugin, {
    ...config.auth,
    service: authService,
  });

  await app.listen(config.server.listen);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
