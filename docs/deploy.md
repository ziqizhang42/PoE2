# Deployment

This is the production runbook for one PoE2 backend, one PostgreSQL database, and Caddy on a single Linux VPS.

## Topology

Only Caddy publishes host ports. It terminates TLS, serves the compiled React application, and proxies `/api`, `/api/ws`, `/health`, and `/ready` to the backend. The backend and PostgreSQL communicate over an internal Docker network with no published ports.

`compose.prod.yaml` starts services in this order:

1. PostgreSQL becomes healthy.
2. The one-shot migration container applies every pending committed migration.
3. The backend starts and becomes database-ready.
4. Caddy starts serving traffic.

The frontend and backend stay on one browser origin, so secure session cookies and WebSocket origin checks need no cross-origin exceptions.

## Host and DNS prerequisites

Install a supported 64-bit Linux distribution, Docker Engine, and the Docker Compose plugin. Use a non-root deployment user with SSH keys; membership in the `docker` group is effectively root access and must be limited accordingly.

At the provider firewall, allow only:

- the chosen SSH port;
- TCP 80 and 443; and
- UDP 443 if HTTP/3 is desired.

Docker-published ports can bypass host-level UFW policy. The production Compose file therefore publishes only Caddy. Keep the provider firewall as the outer boundary.

Point the deployment hostname's `A` record at the VPS. Add an `AAAA` record only when IPv6 is configured and filtered correctly. Caddy needs inbound TCP 80 and 443 to obtain and renew public certificates.

Start with DNS-only records. A CDN adds another proxy trust boundary and changes client-address handling for rate limits. Configure and test trusted CDN ranges before enabling one.

## Release configuration

Clone the repository into a stable location such as `/opt/poe2`, then create the untracked production environment file:

```sh
cd /opt/poe2
install -m 600 .env.prod.example .env.prod
openssl rand -hex 64
```

Fill every blank in `.env.prod`. `APP_VERSION` must be a Docker-tag-safe immutable Git tag or commit SHA, `DOMAIN` is only the public hostname, and `POSTGRES_PASSWORD` must be the generated hexadecimal value. Hex is required by this runbook because Compose interpolates the password into a PostgreSQL URL without another encoding step.

Validate interpolation before any build or startup:

```sh
docker compose \
  --env-file .env.prod \
  -f compose.prod.yaml \
  config --quiet
```

The blank example values deliberately make validation fail until configuration is complete. `docker compose config` renders secrets into its output, so use `--quiet` in terminals, automation, and support transcripts.

`POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` initialize only an empty PostgreSQL volume. Changing them in `.env.prod` later does not rename the live database, rename its role, or rotate its password. Perform those changes inside PostgreSQL and update the application configuration as one planned operation.

## Release gate

Run the repository gate and the fresh-database integration suite before tagging a release:

```sh
docker compose run --rm --no-deps tooling pnpm run check
docker compose run --rm --no-deps tooling pnpm run build
docker compose rm --stop --force db-test
docker compose --profile test run --rm integration-tests
```

Schema changes must include reviewed SQL under `backend/drizzle/`. Production migrations are forward-only and must remain compatible with the previously deployed application while an update is in progress.

## First deployment

Build immutable local image tags from the checked-out release, then start the stack:

```sh
docker compose \
  --env-file .env.prod \
  -f compose.prod.yaml \
  build --pull

docker compose \
  --env-file .env.prod \
  -f compose.prod.yaml \
  up -d --wait
```

The migration container should finish with exit code zero; it is expected to be stopped afterward. Inspect the result without printing interpolated configuration:

```sh
docker compose --env-file .env.prod -f compose.prod.yaml ps --all
docker compose --env-file .env.prod -f compose.prod.yaml logs --tail=200
curl --fail --silent --show-error https://play.example.com/health
curl --fail --silent --show-error https://play.example.com/ready
```

Replace the example hostname in the `curl` commands. `/health` proves the Node process is serving requests; `/ready` also executes a PostgreSQL query and returns `503` while the database is unavailable.

Use two browser profiles to register, play a complete game over WebSocket, refresh during play, and verify that the finished game appears in history and replay.

## Backups

Create a protected staging directory once:

```sh
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /var/backups/poe2
```

Create the first logical backup before accepting durable user data, then schedule the backup and verification commands at least daily:

```sh
cd /opt/poe2
backup_file="/var/backups/poe2/poe2-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose \
  --env-file .env.prod \
  -f compose.prod.yaml \
  exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$backup_file"
test -s "$backup_file"
docker compose --env-file .env.prod -f compose.prod.yaml \
  exec -T db pg_restore --list < "$backup_file" > /dev/null
```

The final two commands reject an empty or unreadable archive, but they are not a restore test. A file on the same VPS is only a staging copy. Send backups to encrypted off-host storage, apply retention, monitor the job, and test a full restore into a disposable PostgreSQL 18 database. Listing an archive or relying on a VPS snapshot is not a restore test.

Never use `docker compose down --volumes` in production. It deletes the PostgreSQL and Caddy named volumes. Treat any restore into the production database as a destructive recovery operation: stop the backend, resolve the exact database target, preserve the failed database, and follow the previously rehearsed restore procedure.

## Updating

For each release:

1. Pass the release gate and tag the commit.
2. Fetch and check out that exact tag on the VPS.
3. Set `APP_VERSION` in `.env.prod` to the same tag.
4. Build the new images while the old stack remains online.
5. Take and verify a database backup.
6. Reconcile the stack and watch the migration/backend logs.
7. Repeat both HTTP checks and the browser smoke test.

```sh
docker compose --env-file .env.prod -f compose.prod.yaml build --pull
docker compose --env-file .env.prod -f compose.prod.yaml up -d --wait --remove-orphans
docker compose --env-file .env.prod -f compose.prod.yaml logs --tail=200 migrate backend caddy
```

Changing `APP_VERSION` gives every release distinct local image tags and keeps the previous images available for an application rollback. To roll back, check out the previous release, restore its `APP_VERSION`, and reconcile Compose again. Do not reverse an applied database migration; deploy migrations using expand/contract changes so the previous application remains compatible.

If a migration container fails, leave the backend on its current version, inspect the migration logs, and fix the forward migration. After the cause is resolved, remove only the stopped one-shot container so Compose can recreate it:

```sh
docker compose --env-file .env.prod -f compose.prod.yaml rm --force migrate
docker compose --env-file .env.prod -f compose.prod.yaml up -d --wait
```

## Routine operations

```sh
docker compose --env-file .env.prod -f compose.prod.yaml ps --all
docker compose --env-file .env.prod -f compose.prod.yaml logs --follow backend caddy
docker compose --env-file .env.prod -f compose.prod.yaml restart backend
docker system df
```

The Compose logging policy retains five 10 MB files per container. Add external uptime monitoring for `/ready` and alerts for host disk, memory, load, and backup failures. A database volume is not a backup, and container restart policies are not monitoring.

Upgrade Node, Caddy, and PostgreSQL patch releases through a normal reviewed release. Never automatically advance the PostgreSQL major image tag: a major upgrade requires a tested `pg_upgrade` or dump/restore plan.

## Scaling boundary

Keep one backend replica. WebSocket connections, broadcasts, admission counts, and rate-limit budgets are process-local, while the rating decay worker also runs inside the backend. Multiple replicas require shared coordination and a deliberate worker ownership model; adding a second container today would not be a safe availability improvement.
