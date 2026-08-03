import process from "node:process";

import { createAuthRepository } from "./auth/repository.js";
import { createAuthService } from "./auth/service.js";
import { buildApp } from "./app.js";
import { readAuthConfig } from "./config/auth.js";
import { readDatabaseConfig } from "./config/database.js";
import { readServerConfig } from "./config/server.js";
import { createDatabaseClient } from "./db/client.js";
import { authPlugin } from "./http/auth.js";

const app = buildApp({ logger: true });

try {
  const serverConfig = readServerConfig(process.env);
  const authConfig = readAuthConfig(process.env);
  const database = createDatabaseClient(readDatabaseConfig(process.env));
  const authService = createAuthService(createAuthRepository(database.db));

  app.addHook("onClose", () => database.close());
  app.register(authPlugin, {
    ...authConfig,
    service: authService,
  });

  await app.listen(serverConfig);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
