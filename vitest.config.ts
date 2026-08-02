import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rulesRoot = fileURLToPath(new URL("./packages/rules", import.meta.url));
const protocolRoot = fileURLToPath(new URL("./packages/protocol", import.meta.url));
const backendRoot = fileURLToPath(new URL("./backend", import.meta.url));
const frontendRoot = fileURLToPath(new URL("./frontend", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@poe2/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
      "@poe2/rules": fileURLToPath(new URL("./packages/rules/src/index.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "@poe2/rules",
          root: rulesRoot,
        },
      },
      {
        extends: true,
        test: {
          name: "@poe2/protocol",
          root: protocolRoot,
        },
      },
      {
        extends: true,
        test: {
          name: "@poe2/backend",
          root: backendRoot,
        },
      },
      {
        extends: true,
        test: {
          environment: "jsdom",
          name: "@poe2/frontend",
          root: frontendRoot,
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});
