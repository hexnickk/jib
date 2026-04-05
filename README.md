# jib

Lightweight CLI for deploying docker-compose apps on bare servers via SSH.
GitHub App auth drives repo polling, a deployer service runs
`docker compose` on the host, and optional modules wire up Cloudflare
tunnels and an nginx reverse proxy. Designed to replace Coolify for small
fleets of home servers and single-box VPS deployments.

## Status

Very early. No stable API. Actively developed. Single-binary CLI built
on Bun.

## Install

On the server you want to deploy onto:

```bash
curl -fsSL https://raw.githubusercontent.com/hexnickk/jib/main/scripts/install.sh | bash
```

The script detects your OS/arch, downloads the matching binary from the
latest GitHub release, and installs it to `/usr/local/bin/jib`. Supported
targets: `linux-x64`, `linux-arm64`, `darwin-arm64`.

Override the release tag or install prefix via env vars:

```bash
JIB_VERSION=v0.1.0 JIB_PREFIX=$HOME/.local/bin \
  curl -fsSL https://raw.githubusercontent.com/hexnickk/jib/main/scripts/install.sh | bash
```

## Quickstart

```bash
# 1. Bootstrap jib on a fresh server. Installs the NATS bus, deployer,
#    and gitsitter systemd units under $JIB_ROOT (default /opt/jib).
jib init

# 2. Register a GitHub App so jib can clone private repos. Walks through
#    the manifest flow and stores credentials under /opt/jib/secrets.
jib github app setup my-org

# 3. Add an app. Port + health check are inferred from the compose file
#    in the target repo.
jib add myapp --repo my-org/myapp --domain myapp.example.com:8080

# 4. Deploy.
jib deploy myapp
```

After the initial deploy, gitsitter polls the repo and publishes a deploy
event whenever the tracked branch advances. The deployer subscribes and
re-runs the deploy end to end.

## Commands

| Command | Description |
|---|---|
| `jib init` | Bootstrap jib on the current host (bus, deployer, gitsitter). |
| `jib add <app>` | Register a new app (repo, branch, domains, compose path). |
| `jib remove <app>` | Unregister an app and tear down its containers. |
| `jib deploy <app>` | Deploy the tracked branch of an app now. |
| `jib rollback <app>` | Roll back to the previous successful deploy. |
| `jib resume <app>` | Resume a paused/failed deploy loop. |
| `jib config` | Inspect or edit the jib config. |
| `jib edit` | Open `config.yml` in `$EDITOR` with validation on save. |
| `jib up \| down \| restart <app>` | Control an app's compose project. |
| `jib exec <app> <service>` | Exec into a running container. |
| `jib run <app> <service>` | Run a one-off container in the app project. |
| `jib secrets <app>` | Manage per-app secrets under `/opt/jib/secrets/<app>`. |
| `jib service` | Manage jib's own systemd units (bus, deployer, gitsitter). |
| `jib webhook` | Manage GitHub webhook routing. |
| `jib github` | GitHub App setup and token management. |
| `jib cloudflare` | Cloudflare tunnel module commands. |

Run `jib <command> --help` for details on any command.

## Architecture

Jib is split into small services that talk over a local NATS bus:

- `main.ts` (CLI) — compiled to a single `jib` binary via `bun build --compile`.
- `modules/nats` — embedded NATS server installed as a systemd unit on `jib init`.
- `modules/deployer` — subscribes to deploy/rollback events and runs `docker compose`.
- `modules/gitsitter` — polls registered repos and publishes deploy events.
- `modules/github` — GitHub App auth + installation token minting.
- `modules/nginx`, `modules/cloudflare`, `modules/cloudflared` — optional
  ingress modules that react to app add/remove events.
- `modules/webhook` — optional inbound webhook handler for push events.

Shared libraries live under `libs/` (`@jib/config`, `@jib/state`,
`@jib/docker`, `@jib/secrets`, `@jib/bus`, `@jib/rpc`, `@jib/tui`,
`@jib/core`). All jib-managed paths honor `$JIB_ROOT` (default `/opt/jib`).

## Contributing

Requirements: [Bun](https://bun.sh) 1.3.11.

```bash
bun install           # install workspace deps
make build            # compile the single-binary CLI to dist/jib
make test             # bun test (uses bun:test)
make lint             # biome check
make fmt              # biome format --write
```

Pre-commit hooks run `biome check`. Fix issues before committing. See
`CLAUDE.md` for project conventions (file size caps, secrets handling,
module layout).

## License

TBD.
