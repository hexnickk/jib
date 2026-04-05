## Memories & Plans

Project memories live in `.claude/memories/` (gitignored, persists across devcontainer rebuilds).
Architecture plans and implementation notes live in `.claude/plans/` (also gitignored).

**Do NOT use the default `~/.claude/projects/` memory location** — it gets wiped when the devcontainer rebuilds.

When saving memories, write to `/workspaces/jib/.claude/memories/` and update `.claude/memories/MEMORY.md`.
When creating plans, write to `/workspaces/jib/.claude/plans/`.

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.

## Project

Jib is a lightweight CLI tool for deploying docker-compose apps on bare servers via SSH. It replaces Coolify.

Stack: GitHub App auth → git polling → docker-compose deploy → Cloudflare tunnels + nginx reverse proxy.

## Architecture

Single-binary CLI built on Bun, compiled via `bun build --compile`.
Internally split into small modules that talk over a local NATS bus. The
split is NOT for scalability — it's so Claude agents can hold each
module entirely in context.

Layout:
- `main.ts` — CLI entrypoint, compiled to the `jib` binary
- `src/commands/` — top-level CLI command implementations
- `libs/*` — shared workspaces: `@jib/config`, `@jib/state`, `@jib/docker`,
  `@jib/secrets`, `@jib/bus`, `@jib/rpc`, `@jib/tui`, `@jib/core`
- `modules/*` — feature workspaces: `deployer`, `gitsitter`, `github`,
  `cloudflare`, `cloudflared`, `nginx`, `nats`
- `tests/` — integration tests (`bun:test`)

Each module under `modules/` can expose a systemd service installer and
its own CLI subcommands, discovered via the module registry.

## Build & Test

```
make build       # compile dist/jib via bun build --compile
make test        # bun test
make lint        # biome check .
make fmt         # biome format --write .
make install-all # build and install dist/jib to /usr/local/bin
```

Pre-commit hooks run `biome check`. Fix issues before committing.

## Conventions

- TypeScript + Bun, strict mode, zero `any`
- Config: `$JIB_ROOT/config.yml` (default `/opt/jib/config.yml`)
- Secrets: `$JIB_ROOT/secrets/<app>/.env` (auto-detected, no config flag needed)
- State: `$JIB_ROOT/state/<app>.json`
- NATS for inter-module messaging
- Module CLI commands are registered via the module workspace exports,
  discovered at startup from `modules/*`
- **Secrets in compose files**: pass secrets to containers as environment
  variables only, via `env_file:` or `environment:`. Never mount secret
  files as volumes (no `volumes: - /path/to/secret:/run/secrets/...`). This
  applies to every compose file jib generates or owns, including infra
  containers under `modules/*`. Config files that aren't secrets (e.g.
  `nats.conf`) may still be volume-mounted.
- All jib-managed paths honor `$JIB_ROOT`. When an installer embeds a
  systemd unit or compose file that references a path, template it at
  install time — do not hardcode `/opt/jib`.

# Important

- Files should target 100 LoC, anything above 200 LoC needs an explicit approval
- Do not add Claude as a co-author to commits
