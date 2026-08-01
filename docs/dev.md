# Development

PoE2 uses a Docker-only development workflow.

The game rules are documented in [rules.md](./rules.md).

## Host requirements

- Docker with Docker Compose
- Git
- an editor

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

`--no-deps` skips starting PostgreSQL. The `tooling` service declares `depends_on: db` with a health condition, so without this flag every command starts the database and waits for its healthcheck to pass. Formatting, linting, type checking, and the current tests do not touch the database, so they use `--no-deps`. Omit the flag for any command that needs a working `DATABASE_URL`.

The tooling service is behind the `tools` Compose profile, so a plain `docker compose up` does not start an idle Node.js container. Explicit `docker compose run ... tooling` commands still work without enabling the profile.

Most commands are `pnpm`, so an alias is worth defining for a session:

```sh
alias pn='docker compose run --rm --no-deps tooling pnpm'
```

The rest of this document spells out the full command for copy-paste.

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

`build` compiles the TypeScript project references. Remove its output with:

```sh
docker compose run --rm --no-deps tooling pnpm run clean
```

## Watch mode

Run the tests in watch mode while working:

```sh
docker compose run --rm --no-deps tooling pnpm run test

docker compose run --rm --no-deps tooling \
  pnpm --filter @poe2/<workspace> test
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

Stop services while preserving all named volumes:

```sh
docker compose down
```

Do not add `--volumes` unless you intentionally want to delete the development database together with the dependency caches.

## Dependency storage

Source code is bind-mounted at `/app`. Installed dependencies and the pnpm content-addressable store live in the Docker volumes mounted at `/app/node_modules` and `/pnpm/store`.

Host installs are unsupported. `pnpm install` on the host would most likely fail outright, since `storeDir` points at `/pnpm/store` inside the container, and anything it did produce would target the host platform rather than Linux.

The first install into an empty store downloads all packages. Later installs reuse the named volumes. A one-time prompt to rebuild `node_modules` is expected after changing pnpm's store or module configuration.

## Troubleshooting

To rebuild the dependency volume without deleting the database data or the pnpm store:

```sh
docker compose down
docker volume rm poe2_node-modules
docker compose run --rm --no-deps tooling pnpm install --frozen-lockfile
```
