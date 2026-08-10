# Developer guide

The supported local workflow is Docker Compose. It pins Node.js, pnpm, PostgreSQL, and native build tools; host Node installations are not part of the development contract. `compose.yaml` remains development-only; production uses [`compose.prod.yaml`](../compose.prod.yaml) and the [deployment runbook](./deploy.md).

## Documentation map

- [Game rules](./rules.md): the stable rules implemented by `@poe2/rules`.
- [Live protocol](./protocol.md): WebSocket lifecycle, ordering, and authority.
- [HTTP API](./http.md): authentication and public read endpoints.
- [Ratings](./rating.md): rating policy, persistence, decay, and ladder entry.
- [Frontend](./ui.md): browser architecture and state ownership.
- [Deployment](./deploy.md): the single-VPS production topology and runbook.

Schemas, defaults, error unions, and component behavior belong in source. These guides cover only workflows and cross-cutting constraints that are costly to rediscover.

## First setup

Requirements are Git and Docker with Compose v2. From the repository root:

```sh
docker compose build --pull tooling
docker compose run --rm --no-deps tooling pnpm install --frozen-lockfile
docker compose up -d --wait db
docker compose run --rm tooling \
  pnpm --filter @poe2/backend run db:migrate
docker compose run --rm --no-deps tooling pnpm run check
docker compose run --rm --no-deps tooling pnpm run build
```

Dependencies live in the `node-modules` named volume, not the bind-mounted host directory. Re-run the locked install after pulling a changed `pnpm-lock.yaml`.

## Run the application

Start the frontend and its backend/database dependencies:

```sh
docker compose --profile app up -d --wait frontend
```

Open <http://localhost:5173>. The backend health check is available through the frontend proxy at <http://localhost:5173/health>.

```sh
docker compose logs --follow frontend backend
docker compose down
```

Source is bind-mounted. Vite uses React Refresh, and the backend runs Node in watch mode with the `development` export condition so shared package source is loaded without rebuilding `dist`.

Run one-off project commands in the same image:

```sh
docker compose run --rm --no-deps tooling <command>
```

Use `--no-deps` for commands that do not need PostgreSQL. Omit it for commands that need the Compose-provided `DATABASE_URL`. Removing the command container with `--rm` does not remove named dependency, package-store, or database volumes.

## Editor container

VS Code can reopen the repository using [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json). It attaches to `tooling`, installs locked dependencies on creation, and starts in `/app`; run `pnpm` directly inside it.

This repository pins the TypeScript 7 native compiler. It does not ship `tsserver.js`, so the container enables the TypeScript native-preview extension and points it at the workspace compiler. If editor diagnostics disagree with `pnpm run typecheck`, verify the **TypeScript 7** output channel before changing project configuration. `pnpm-workspace.yaml` hoists the platform package needed by that extension.

Docker is not mounted into the editor container. Run Compose commands, including integration tests, from the host.

## Quality and tests

The normal local gate is:

```sh
docker compose run --rm --no-deps tooling pnpm run check
docker compose run --rm --no-deps tooling pnpm run build
```

`check` runs formatting, linting with warnings denied, TypeScript project checks, and all non-integration Vitest projects. Useful narrower commands are:

```sh
docker compose run --rm --no-deps tooling pnpm run format
docker compose run --rm --no-deps tooling pnpm run lint:fix
docker compose run --rm --no-deps tooling pnpm run test
docker compose run --rm --no-deps tooling \
  pnpm exec vitest run --project @poe2/frontend
```

Database integration tests use an isolated, unpublished, in-memory PostgreSQL service and apply every migration before running:

```sh
docker compose --profile test run --rm integration-tests
```

To prove the complete migration chain against a new database, remove the throwaway test container first:

```sh
docker compose rm --stop --force db-test
docker compose --profile test run --rm integration-tests
```

Integration test files run sequentially because they share that database.

## Repository architecture

| Path | Responsibility |
| --- | --- |
| `packages/rules` | Pure, deterministic game rules with no browser, server, or database dependency |
| `packages/protocol` | Zod schemas and inferred types for every network boundary |
| `backend` | Fastify HTTP/WebSocket services and PostgreSQL persistence |
| `frontend` | React application and browser transports |

Dependency direction is `rules` → `protocol` → applications; both applications may import the shared packages, but neither shared package may import an application. The backend is authoritative for game lifecycle, clocks, and ratings. The frontend derives presentation from complete validated snapshots.

The project uses ESM with NodeNext resolution. Relative TypeScript imports use `.js` specifiers even though the source file ends in `.ts`. Root TypeScript project references define build order, and Vitest aliases shared packages to source for unit tests.

For subsystem boundaries, start at:

- [`backend/src/server.ts`](../backend/src/server.ts) for service composition;
- [`backend/src/game/service.ts`](../backend/src/game/service.ts) for game transactions;
- [`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts) for the network schema surface;
- [`packages/rules/src/index.ts`](../packages/rules/src/index.ts) for rule exports; and
- [`frontend/src/runtime/create-runtime.ts`](../frontend/src/runtime/create-runtime.ts) for browser dependencies.

## Development proxy and ports

| Service                | Host address     | Override        |
| ---------------------- | ---------------- | --------------- |
| Frontend               | `127.0.0.1:5173` | `FRONTEND_PORT` |
| Backend                | `127.0.0.1:3000` | `BACKEND_PORT`  |
| Development PostgreSQL | `127.0.0.1:5432` | `POSTGRES_PORT` |

Set overrides in the environment of the Compose command. If the frontend port changes, its WebSocket origin in `compose.yaml` changes with it.

Vite proxies `/api`, `/api/ws`, `/health`, and `/ready` to the backend. It appends the client address, and the Compose backend trusts exactly one positional proxy hop. That is safe only while the published backend port remains loopback-only: a client connecting directly is itself the trusted hop and can forge forwarding headers. Production uses Caddy as the sole positional hop and does not publish the backend port.

WebSocket upgrades carry cookies but are not protected by the browser's same-origin policy. `WEBSOCKET_ALLOWED_ORIGINS` is therefore an explicit origin allowlist; wildcards are rejected and production requires a value.

## Configuration

Environment parsing fails at startup on invalid values. Read defaults and bounds from their validators instead of copying them into documentation:

| Concern | Source |
| --- | --- |
| Database URL | [`config/database.ts`](../backend/src/config/database.ts) |
| Listen address and proxy hops | [`config/server.ts`](../backend/src/config/server.ts) |
| Session lifetime and cookie policy | [`config/auth.ts`](../backend/src/config/auth.ts) |
| WebSocket origins | [`config/websocket.ts`](../backend/src/config/websocket.ts) |
| WebSocket connection and command limits | [`config/ws-limits.ts`](../backend/src/config/ws-limits.ts) |
| Password hashing capacity | [`config/kdf.ts`](../backend/src/config/kdf.ts) |
| Active deadline capacity | [`config/deadline.ts`](../backend/src/config/deadline.ts) |
| Rating periods and decay worker | [`config/rating-decay.ts`](../backend/src/config/rating-decay.ts) |

`DATABASE_URL` is required for the backend and Drizzle commands. Compose supplies development and test values. Production values and operational requirements are defined in the [deployment runbook](./deploy.md).

## Database migrations

[`backend/src/db/schema.ts`](../backend/src/db/schema.ts) is the application schema; committed SQL in `backend/drizzle/` is the upgrade path. Do not use schema push as a substitute for migrations.

After changing the schema, generate and review a named migration:

```sh
docker compose run --rm --no-deps tooling \
  pnpm --dir backend exec drizzle-kit generate \
  --config drizzle.config.ts --name=<name>
docker compose run --rm --no-deps tooling \
  pnpm --filter @poe2/backend run db:check
```

Then run the fresh integration database before applying it to development:

```sh
docker compose rm --stop --force db-test
docker compose --profile test run --rm integration-tests
docker compose run --rm tooling \
  pnpm --filter @poe2/backend run db:migrate
```

Review generated SQL and journal changes together. Before the first deployment, databases contain only disposable fixtures: reset a database that predates the current migration chain instead of adding fixture cleanup to committed SQL. The migrations themselves must remain non-destructive. Once a migration has reached a shared or production database, never rewrite it; add a new explicit cleanup or backfill instead.

Drizzle applies all pending migrations in one transaction. PostgreSQL does not allow a newly added enum value to be consumed before that transaction commits; when a later pending migration must compare such a value, cast the enum column to `text` as the existing timeout constraints do. Always test upgrades with multiple pending versions, not only one migration at a time.

## Dependency changes

Add shared tooling at the root or runtime dependencies to one workspace:

```sh
docker compose run --rm --no-deps tooling \
  pnpm add --workspace-root --save-dev --save-exact <package>
docker compose run --rm --no-deps tooling \
  pnpm --filter @poe2/<workspace> add <package>
```

Commit `package.json` and `pnpm-lock.yaml` together. Rebuild `tooling` after a `Dockerfile.dev` change; reinstall locked dependencies after lockfile changes.

Avoid `docker compose down -v` during ordinary troubleshooting: it deletes the development database and dependency volumes. Start with logs, container health, a locked reinstall, or a tooling-image rebuild instead.
