# Jib — Roadmap

## Completed

All items below have been implemented, reviewed, and tested.

- [x] Fix exit codes — non-zero on failure for all commands
- [x] Fix `jib config set` type handling — booleans, numbers parsed correctly
- [x] `jib remove <app>` — full cleanup (containers, nginx, state, secrets, repo, config)
- [x] `jib env set/del` — per-variable secrets management
- [x] `jib history` — append-only event log wired into deploy/rollback
- [x] Maintenance mode — `jib maintenance on/off/status` with nginx 503 swap
- [x] Resource limits — auto-suggested CPU/memory per app, written to overrides
- [x] `jib upgrade` — self-update from GitHub Releases
- [x] `jib init` — interactive onboarding (deps, SSL/tunnel choice, dirs, config, systemd)
- [x] Notifications — named instances, per-app routing, `jib telegram/slack/discord` commands
- [x] `jib github setup/status/remove` — deploy keys + webhook secrets
- [x] `jib cloudflare setup/add/status` — Cloudflare Tunnel management
- [x] `jib tailscale setup/status` — Tailscale management
- [x] Shared services — `jib service add/list/status/remove` (Postgres/MySQL/MariaDB/Redis/MongoDB)
- [x] Backup/restore — multiple destinations (R2/S3/SSH/local), retention, volume backup
- [x] Daemon — autodeploy polling, webhook server, backup scheduler, health monitor, cert watcher

## Up Next

### Blue-green deploy strategy (zero-downtime)
The `restart` strategy has brief downtime during container swap. Blue-green deploys to an inactive slot, health checks it, then swaps nginx — zero downtime. The config schema already supports `strategy: blue-green` but the engine only implements `restart`.

### Preview/branch deploys
Deploy a PR branch to a temporary subdomain (`pr-42.myapp.com`), auto-destroy when merged. Requires: parallel container sets, temporary nginx configs, wildcard cert or per-preview cert, cleanup via webhook or polling.

### GitLab integration
Same as `jib github setup` but for GitLab — deploy tokens, webhook registration, push event parsing. The daemon webhook server already parses GitLab payloads, just needs the setup CLI.

### Wildcard SSL certificates
Per-domain certbot works but doesn't scale. Wildcard certs (`*.myapp.com`) via DNS challenge would simplify multi-domain and preview deploy setups.
