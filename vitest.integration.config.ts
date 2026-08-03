import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const backendRoot = fileURLToPath(new URL("./backend", import.meta.url));

export default defineConfig({
  test: {
    name: "@poe2/backend-integration",
    root: backendRoot,
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
  },
});
