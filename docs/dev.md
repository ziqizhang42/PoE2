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

The frontend runs Vite with React Refresh and Tailwind. Requests to `/health` and `/api` are proxied to the backend using the internal `http://backend:3000` Compose address.

The backend runs in Node.js watch mode with tsx loaded. The `development` export condition makes workspace packages resolve to their TypeScript source, so edits to imported shared packages restart the server without rebuilding `dist`. Production does not enable that condition and resolves compiled JavaScript instead.

### Client addresses through the proxy

Browser traffic reaches the backend through the Vite container, so from Fastify's point of view every request arrives from that one container. Left alone, that would give every browser the same rate-limit key.

The Vite proxy therefore sets `xfwd: true` in [vite.config.ts](../frontend/vite.config.ts), which appends the connection's real peer address to `x-forwarded-for`. The backend reads `TRUST_PROXY_HOPS`, which Compose sets to `1`, and trusts exactly that one hop, so `request.ip` becomes the real client.

`TRUST_PROXY_HOPS` defaults to `0`, meaning no forwarding header is trusted at all, and it accepts no value above `1`. An unconfigured backend is therefore reachable directly without honouring headers anyone can send. Fastify is never configured with `trustProxy: true`, which would trust the whole chain.

Because Fastify skips only the one trusted hop and takes the address that hop appended, a client reaching the backend **through Vite** cannot choose its own key: whatever it puts in `x-forwarded-for` always sits to the left of the address Vite appended, and is discarded.

Note that Fastify's hop count is positional, not address-based: hop 0 is whoever opened the socket, and it is trusted unconditionally. Anything that can connect to the backend directly - a process on the developer's machine, or another container on the Compose network - can therefore set `request.ip` to any value it likes and pick its own rate-limit bucket:

```sh
curl -H 'x-forwarded-for: 9.9.9.9' http://localhost:3000/api/auth/session
```

That is accepted here because everything inside the development stack is already trusted, and because the published ports are loopback-only. It is not acceptable in production. Pinning a specific reverse-proxy address needs a `trustProxy` **function** rather than a hop count, and belongs with the production deployment work; a bare CIDR string would be worse than the hop count, because it walks the whole chain while addresses stay private.

Adding a second proxy in front of Vite would also break the count. Raise the ceiling in [server.ts](../backend/src/config/server.ts) deliberately when that happens.

### Published ports

The frontend and backend publish ports 5173 and 3000 by default, and PostgreSQL publishes 5432. All three are bound to `127.0.0.1`, so a development stack is reachable from the machine running it and not from the rest of the network. Container-to-container addresses are unaffected by this and by any host-port override:

```sh
FRONTEND_PORT=5174 BACKEND_PORT=3001 \
  docker compose --profile app up -d frontend
```

To run only PostgreSQL and the backend:

```sh
docker compose --profile app up -d --wait backend
curl --fail --show-error http://localhost:3000/health
```

### Authentication limits

Two independent rate limits protect the authentication routes, both keyed in memory in the single backend process. A shared store is deferred until there is more than one.

- **Per client address.** At most x register or login requests per minute from one `request.ip`, applied before any expensive work. Register and login share this budget.
- **Per normalized username.** At most x _failed_ logins per five minutes against one account, however many addresses they come from. Usernames are normalized case-insensitively, so `Player_One` and `PLAYER_ONE` share one budget. Successful logins are not counted, and registration is not subject to this limit.

Both answer with the same `429` body and the same fixed `Retry-After`, so a caller cannot tell which limit it hit or whether the username exists.

The username limit is a deliberate trade-off: an attacker who knows a username can still lock that account out for a while, but this stops credential stuffing and password guessing against a known account.

Password hashing is bounded separately. At most `PASSWORD_KDF_MAX_CONCURRENT` operations run at once with at most `PASSWORD_KDF_MAX_QUEUED` waiting (FIFO). Beyond that the backend sheds load immediately with a `503` and a short `Retry-After` rather than queueing unbounded work. That response is identical whether or not the username exists.

Stored password hashes carry the Argon2 parameters they were produced with, so the cost policy can be raised without locking anyone out: an older hash is verified with its own parameters and rewritten under the current policy on the next successful login. Parameters are bounds-checked, and the stored value's length is capped, before Argon2 is invoked or anything is decoded, so a tampered row cannot request an enormous amount of memory or work.

Verifying with the parameters stored per hash means rejections would otherwise cost different amounts: an account still on an older, cheaper policy would answer faster than one that does not exist, which is exactly the existence oracle the generic error is there to prevent. Every rejected login therefore spends at least one current-policy derivation. That bounds the difference rather than erasing it so a wrong password against an older hash still pays that cheaper verification on top, so it lands slightly slower than the rest and the gap disappears as logins migrate hashes forward.

### Testing authentication

Development usernames persist in PostgreSQL, so re-running the same example twice fails with `username_taken`. Use a timestamped username to keep examples repeatable:

```sh
auth_username="dev_$(date +%s)"
auth_cookie_jar="$(mktemp)"
```

Register a user, keeping cookies in a temporary jar so the session persists across requests:

```sh
curl --fail --show-error \
  --cookie-jar "$auth_cookie_jar" \
  --header 'content-type: application/json' \
  --data "{\"username\":\"$auth_username\",\"password\":\"correct horse battery staple\"}" \
  http://localhost:5173/api/auth/register
```

Confirm the session cookie authenticates subsequent requests:

```sh
curl --fail --show-error \
  --cookie "$auth_cookie_jar" \
  http://localhost:5173/api/auth/session
```

Log out, which clears the session, then remove the temporary cookie jar:

```sh
curl --fail --show-error \
  --cookie "$auth_cookie_jar" \
  --cookie-jar "$auth_cookie_jar" \
  --request DELETE \
  http://localhost:5173/api/auth/session

rm -f -- "$auth_cookie_jar"
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

PostgreSQL is available to other Compose services at `db:5432`. From the host, it is available at `127.0.0.1:5432` by default; like the other development ports it is published on loopback only.

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
