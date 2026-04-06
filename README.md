# jib

Lightweight CLI for deploying docker-compose apps on bare servers via SSH.
GitHub App auth drives repo polling, a deployer service runs
`docker compose` on the host, and optional modules wire up Cloudflare
tunnels and an nginx reverse proxy. Designed to replace Coolify for small
fleets of home servers and single-box VPS deployments.

## Status

Very early. No stable API. Actively developed. Single-binary CLI built
on Bun.

## Requirements

- **Docker Compose 2.24+** on the target server. Jib writes override files
  that use the `!override` YAML tag to *replace* the user's `ports:` list
  instead of merging with it — a feature introduced in Compose 2.24 (Jan
  2024). Older versions will silently merge, leaving containers bound to
  the wrong host port and nginx routing to nothing.

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
#    gitsitter, and nginx under $JIB_ROOT (default /opt/jib). Asks how
#    traffic reaches the server — if via Cloudflare Tunnel, also installs
#    cloudflared and prompts for a tunnel token. Must run as root.
jib init

# 2. Register a GitHub App so jib can clone private repos. Walks through
#    the manifest flow and stores credentials under /opt/jib/secrets.
jib github app setup my-org

# 3. Add an app. The target service's container port is inferred from the
#    compose file's `ports:` or `expose:` section; host ports are allocated
#    by jib and proxied by the nginx operator. Multi-service repos can
#    pin each domain to a service via `=service`:
#      jib add myapp --repo ... --domain api.example.com=api,web.example.com=web
#
#    Important: jib owns host port allocation. Any `ports:` field in your
#    compose file will be *replaced* by jib's generated override at deploy
#    time (via the `!override` tag — Compose 2.24+). Prefer `expose:` in
#    your compose file to avoid surprise warnings.
jib add myapp --repo my-org/myapp --domain myapp.example.com

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
| `jib config` | Inspect or edit the jib config. |
| `jib edit` | Open `config.yml` in `$EDITOR` with validation on save. |
| `jib up \| down \| restart <app>` | Control an app's compose project. |
| `jib exec <app> <service>` | Exec into a running container. |
| `jib run <app> <service>` | Run a one-off container in the app project. |
| `jib secrets <app>` | Manage per-app secrets under `/opt/jib/secrets/<app>`. |
| `jib service` | Manage jib's own systemd units (bus, deployer, gitsitter, nginx). |
| `jib github` | Manage git auth providers (GitHub App or SSH deploy key). |
| `jib cloudflare` | Cloudflare tunnel commands (`setup`, `status`, `set-token`). |

Run `jib <command> --help` for details on any command.

## Architecture

Jib is split into small services that talk over a local NATS bus:

- `main.ts` (CLI) — compiled to a single `jib` binary via `bun build --compile`.
- `modules/nats` — embedded NATS server installed as a systemd unit on `jib init`.
- `modules/deployer` — long-running operator; subscribes to deploy commands
  and runs `docker compose`. jib does not roll back: if a deploy breaks,
  push a fix-forward commit. Migrations aren't safely reversible, so
  reverting only the code would leave the app out of sync with its data.
- `modules/gitsitter` — long-running operator; polls registered repos and
  prepares workdirs on `cmd.repo.prepare`.
- `modules/nginx` — long-running operator; writes per-app nginx site
  configs on `cmd.nginx.claim` / `cmd.nginx.release` and probes
  `/etc/letsencrypt/live` to decide whether to emit a TLS server block.
- `modules/cloudflare` — CLI-only module; provides `setup`, `status`, and
  `set-token` commands for configuring Cloudflare Tunnel credentials.
- `modules/cloudflared` — optional tunnel daemon installed as a compose
  unit; enabled after a tunnel token is stored via `jib init` or
  `jib cloudflare set-token`.
- `modules/github` — GitHub App auth + installation token minting.

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
