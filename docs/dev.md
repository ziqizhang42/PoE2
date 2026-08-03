# Development

PoE2 uses a Docker-only development workflow.

The game rules are documented in [rules.md](./rules.md).

## Host requirements

- Docker with Docker Compose
- Git
- an editor. VS Code with the Dev Containers extension is configured directly; see [Editor setup](#editor-setup)

## First-time setup

Build the tooling image, install the locked dependencies, and run all current checks:

```sh
docker compose build --pull tooling
docker compose run --rm --no-deps tooling pnpm install --frozen-lockfile
docker compose run --rm --no-deps tooling pnpm run check
docker compose run --rm --no-deps tooling pnpm run build
```

Then start PostgreSQL and confirm it is healthy:

```sh
docker compose up -d db
docker compose ps
docker compose exec -T db psql \
  -U poe2_dev \
  -d poe2_dev \
  -c 'select current_user, current_database(), version();'
```

Then apply the committed migrations:

```sh
docker compose run --rm tooling \
  pnpm --filter @poe2/backend run db:migrate
```

## Running project commands

Run project commands through the `tooling` service:

```sh
docker compose run --rm --no-deps tooling <command>
```

Open an interactive shell in the same environment:

```sh
docker compose run --rm --no-deps tooling bash
```

`--rm` removes the temporary command container when it exits. It does not remove the persistent `node-modules`, `pnpm-store`, or `postgres-data` volumes.

`--no-deps` skips starting PostgreSQL. The `tooling` service declares `depends_on: db` with a health condition, so without this flag every command starts the database and waits for its healthcheck to pass. Formatting, linting, type checking, and the default unit test suite do not touch the database, so they use `--no-deps`. Omit the flag for any command that needs a working `DATABASE_URL`.

The tooling service is behind the `tools` Compose profile, so a plain `docker compose up` does not start an idle Node.js container. Explicit `docker compose run ... tooling` commands still work without enabling the profile, as does the dev container, which names the service explicitly.

Most commands are `pnpm`, so an alias is worth defining for a session:

```sh
alias pn='docker compose run --rm --no-deps tooling pnpm'
```

The rest of this document spells out the full command for copy-paste.

## Editor setup

Dependencies live in a Docker volume rather than on the host, so a host editor cannot resolve any import and reports errors across every file. The language server has to run inside the container.

VS Code does that through [.devcontainer/devcontainer.json](../.devcontainer/devcontainer.json). Install the Dev Containers extension, then run **Dev Containers: Reopen in Container** from the command palette.

It attaches to the same `tooling` service the commands above use, so there is no second image to maintain. On first creation it runs `pnpm install --frozen-lockfile`, because `/app/node_modules` is an empty volume on a fresh clone.

Inside the container, drop the `docker compose run --rm --no-deps tooling` prefix.

Creating the container also installs the extensions this project expects. Formatting runs on save through oxfmt, using the same [.oxfmtrc.json](../.oxfmtrc.json) that `pnpm run format:check` reads, so saving a file cannot introduce a formatting failure in the quality gate.

The integrated terminal already sits in `/app` with the right toolchain on `PATH`. Git works there too. Note that Docker itself is not available inside the container.

Editor settings are seeded into the container when it is created, so **Dev Containers: Rebuild Container** is what applies a change to `Dockerfile.dev`, `compose.yaml`, or the `extensions` list. A change to `settings` alone needs only **Developer: Reload Window**. Rebuilding always works and discards nothing outside the container filesystem.

### TypeScript in the editor

`typescript@7` is the native Go compiler. It ships no `tsserver.js`, so the language service built into VS Code cannot run it and the usual `typescript.tsdk` setting does not apply. Three settings hand TypeScript over to the native-preview extension instead:

- `js/ts.experimental.useTsgo` stands the built-in server down
- `js/ts.tsdk.path` points the extension at the workspace compiler
- `publicHoistPattern` in [pnpm-workspace.yaml](../pnpm-workspace.yaml) makes that path resolvable

The extension locates the compiler at `<tsdk>/../@typescript/<platform-package>`, but pnpm's isolated layout never creates `node_modules/@typescript`. Without the hoist pattern the lookup fails silently and the editor uses the compiler bundled with the extension, which is a different version from the one `pnpm check` runs. Changing that setting requires a reinstall, and pnpm prompts once to rebuild `node_modules`.

To confirm which compiler is serving the editor, open the **TypeScript 7** output channel. It logs the resolved binary path on startup.

## Quality commands

Run the full local quality gate:

```sh
docker compose run --rm --no-deps tooling pnpm run check
```

The full check verifies formatting, linting, TypeScript, and non-watch tests. Individual commands are also available:

```sh
docker compose run --rm --no-deps tooling pnpm run format:check
docker compose run --rm --no-deps tooling pnpm run lint
docker compose run --rm --no-deps tooling pnpm run typecheck
docker compose run --rm --no-deps tooling pnpm run test:run
docker compose run --rm --no-deps tooling pnpm run build

docker compose run --rm --no-deps tooling pnpm run format
docker compose run --rm --no-deps tooling pnpm run lint:fix
```

Database integration tests run separately because they require PostgreSQL:

```sh
docker compose --profile test run --rm integration-tests
```

This starts the isolated `db-test` service, applies all committed migrations, and runs the integration suite. It does not use or modify the persistent development database.

`build` first compiles and typechecks the TypeScript project-reference graph. Because each package's `tsconfig.json` is a solution file, a root build walks every referenced source, test, and tool project. It then runs each workspace's optional `bundle` script. Remove TypeScript and bundle output with:

```sh
docker compose run --rm --no-deps tooling pnpm run clean
```

## TypeScript project layout

Every workspace has a references-only `tsconfig.json`. It owns no files itself; it points the editor and `tsc -b` at the projects that actually own each file.

Backend and shared packages reference two projects:

- `tsconfig.build.json` emits `dist`, excludes tests, and sets `types: []`.
- `tsconfig.test.json` typechecks sources and tests with `noEmit` and Node.js types.

The frontend references three projects because its code runs in two environments:

- `tsconfig.build.json` typechecks browser source, excludes tests, and uses DOM and Vite types. Vite owns JavaScript emission.
- `tsconfig.test.json` typechecks browser source and jsdom tests without emitting.
- `tsconfig.node.json` typechecks `vite.config.ts` with Node.js types.

Sources and tests need different compiler options. The references-only solution file also fixes an editor problem: a language server assigns an open file to the nearest `tsconfig.json`. If that file excluded tests, test files would fall into an inferred project using TypeScript's stock defaults and could silently skip the strict options in [tsconfig.base.json](../tsconfig.base.json).

With the solution file, the language server walks its references and assigns each file to the project that includes it. For example:

```
computeConfigFileName:: score.test.ts :: Result: packages/rules/tsconfig.json
Project does not contain file (no root files)
Searching 2 project references
    tsconfig.build.json -> Project does not contain file
    tsconfig.test.json  -> Project contains file directly
Found default configured project: packages/rules/tsconfig.test.json
```

The trace comes from the **TypeScript 7** output channel.

### Adding a package

Create a references-only `tsconfig.json`, separate build and test projects, and add the workspace to `references` in the root [tsconfig.json](../tsconfig.json). Add another project when package-owned tooling runs in a different environment.

A root `pnpm run build` walks the complete reference graph. Backend and shared package builds emit compiled modules directly; the frontend typechecks through project references and bundles through Vite.

## Watch mode

Run the tests in watch mode while working:

```sh
docker compose run --rm --no-deps tooling pnpm run test

docker compose run --rm --no-deps tooling \
  pnpm exec vitest --project @poe2/<workspace>
```

## Development services

Start the full development stack and wait for PostgreSQL, the backend, and the frontend to become healthy:

```sh
docker compose --profile app up -d --wait frontend
docker compose ps
```

Open [http://localhost:5173](http://localhost:5173) in a browser. Verify both the Vite server and its backend proxy from the command line:

```sh
curl --fail --show-error http://localhost:5173/
curl --fail --show-error http://localhost:5173/health

docker compose logs --follow frontend backend
```

The frontend runs Vite with React Refresh and Tailwind. Requests to `/health` are proxied to the backend using the internal `http://backend:3000` Compose address.

The backend runs in Node.js watch mode with tsx loaded. The `development` export condition makes workspace packages resolve to their TypeScript source, so edits to imported shared packages restart the server without rebuilding `dist`. Production does not enable that condition and resolves compiled JavaScript instead.

The frontend and backend publish ports 5173 and 3000 by default. Override only their host ports when necessary; container-to-container addresses do not change:

```sh
FRONTEND_PORT=5174 BACKEND_PORT=3001 \
  docker compose --profile app up -d frontend
```

To run only PostgreSQL and the backend:

```sh
docker compose --profile app up -d --wait backend
curl --fail --show-error http://localhost:3000/health
```

## Adding dependencies

Add shared development tooling at the workspace root:

```sh
docker compose run --rm --no-deps tooling \
  pnpm add --workspace-root --save-dev --save-exact <package>
```

Add a runtime dependency to one workspace package:

```sh
docker compose run --rm --no-deps tooling \
  pnpm --filter @poe2/<workspace> add <package>
```

Commit both the changed `package.json` file and `pnpm-lock.yaml`.

## Staying current

After pulling changes that touch `pnpm-lock.yaml`, reinstall:

```sh
docker compose run --rm --no-deps tooling pnpm install --frozen-lockfile
```

After changing `Dockerfile.dev`, rebuild the image:

```sh
docker compose build tooling
```

Refresh the floating Node.js base image when desired:

```sh
docker compose build --pull tooling
```

## PostgreSQL

PostgreSQL is available to other Compose services at `db:5432`. From the host, it is available at `localhost:5432` by default.

The `tooling` service receives the connection string as `DATABASE_URL`:

```
postgresql://poe2_dev:poe2_dev@db:5432/poe2_dev
```

That address only resolves inside the Compose network. Host tools must use `localhost` and the published port instead.

If port 5432 is already occupied, choose another host port without changing the container-to-container address:

```sh
POSTGRES_PORT=5433 docker compose up -d db
```

That applies to one command. To persist the override, put `POSTGRES_PORT=5433` in `.env`, which Compose loads automatically and Git ignores.

### Migrations

The Drizzle schema is in `backend/src/db/schema.ts`. Generated SQL migrations and their metadata are committed under `backend/drizzle/`.

After changing the schema, generate a named migration:

```sh
docker compose run --rm --no-deps tooling \
  pnpm --dir backend exec drizzle-kit generate \
  --config drizzle.config.ts \
  --name=add_games
```

Inspect the generated SQL, then verify the migration history:

```sh
docker compose run --rm --no-deps tooling \
  pnpm --filter @poe2/backend run db:check
```

Apply committed migrations to the persistent development database:

```sh
docker compose run --rm tooling \
  pnpm --filter @poe2/backend run db:migrate
```

The integration database is profile-gated, has no published port, and stores data in memory. Remove it when a completely fresh test database is wanted:

```sh
docker compose rm --stop --force db-test
```

This removes only disposable test data. It does not affect `db` or the `postgres-data` volume.

Stop services while preserving all named volumes:

```sh
docker compose down
```

Do not add `--volumes` unless you intentionally want to delete the development database together with the dependency caches.

## Dependency storage

Source code is bind-mounted at `/app`. Installed dependencies and the pnpm content-addressable store live in the Docker volumes mounted at `/app/node_modules` and `/pnpm/store`.

Host installs are unsupported. `pnpm install` on the host would most likely fail outright, since `storeDir` points at `/pnpm/store` inside the container, and anything it did produce would target the host platform rather than Linux.

The first install into an empty store downloads all packages. Later installs reuse the named volumes. A one-time prompt to rebuild `node_modules` is expected after changing pnpm's store or module configuration.

pnpm also creates ignored `node_modules` directories inside workspace packages. These contain symlinks into `/app/node_modules/.pnpm`; the dependency payload still lives in the Docker volume. Because source is bind-mounted, the symlink directories are visible on the host and may appear broken to host tools. They are expected and are recreated by the containerized install.

## Troubleshooting

To rebuild the dependency volume without deleting the database data or the pnpm store:

```sh
docker compose down
docker volume rm poe2_node-modules
docker compose run --rm --no-deps tooling pnpm install --frozen-lockfile
```
