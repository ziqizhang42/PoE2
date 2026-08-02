import process from "node:process";

import { buildApp } from "./app.js";
import { readServerConfig } from "./config/server.js";

const app = buildApp({ logger: true });

try {
  const config = readServerConfig(process.env);
  await app.listen(config);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
