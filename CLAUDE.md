# Jib — Claude Code Guide

## Memories & Plans

Project memories live in `.claude/memories/` (gitignored, persists across devcontainer rebuilds).
Architecture plans and implementation notes live in `.claude/plans/` (also gitignored).

**Do NOT use the default `~/.claude/projects/` memory location** — it gets wiped when the devcontainer rebuilds.

When saving memories, write to `/workspaces/jib/.claude/memories/` and update `.claude/memories/MEMORY.md`.
When creating plans, write to `/workspaces/jib/.claude/plans/`.

## Project

Jib is a lightweight CLI tool for deploying docker-compose apps on bare servers via SSH. It replaces Coolify.

Stack: GitHub App auth → git polling → docker-compose deploy → Cloudflare tunnels + nginx reverse proxy.

## Architecture

Micro-service design — each service is a separate binary with one responsibility. Services communicate via NATS. This is NOT for scalability — it's so Claude agents can hold each service entirely in context.

Services live under `services/` in the monorepo. Shared code lives under `internal/`.

Services:
- `services/jib-deployer/` — handles deploys, rollbacks, resume via NATS
- `services/jib-watcher/` — polls git repos, triggers deploys via NATS
- `services/jib-heartbeat/` — publishes periodic heartbeat to NATS
- `services/jib-health/` — HTTP health checks (Docker container)
- `services/jib-notifications-telegram/` — Telegram notifications (Docker container)

## Build & Test

```
make build      # build jib binary
make build-all  # build jib + all services
make install-all # build and install all binaries
make test       # go test ./...
make lint       # golangci-lint
make fmt        # gofmt
make bootstrap  # install dev tools (gopls)
```

Pre-commit hooks run `gofmt` and `golangci-lint`. Fix issues before committing.

## Conventions

- Go, standard project layout
- Config: `/opt/jib/config.yml` (schema v3)
- Secrets: `/opt/jib/secrets/<app>/.env` (auto-detected, no config flag needed)
- State: `/opt/jib/state/<app>.json`
- NATS for inter-service messaging
- Modules in `internal/module/` register at startup via `module.Register()`
