# Jib Testing Report

Tested on DigitalOcean droplet (1 vCPU, 2GB RAM, Ubuntu 24.04) with domain `basilapp.co` behind Cloudflare.

## Test Matrix

### Deploy Scenarios

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | **FE + BE + DB (volume)** | PASS | React frontend, Node API, Postgres with `db_data` volume. Data persists across restarts. See `samples/fullstack/` |
| 2 | **Backend-to-backend** | PASS | Worker polls fullstack API via `host.docker.internal`. Cross-network by default (each app gets own Docker network). See `samples/worker/` |
| 3 | **Secrets injection** | PASS | `secrets_env: true` creates symlink from `/opt/jib/secrets/<app>/.env` into repo. Deploy blocked when secrets missing. See `samples/secretapp/` |
| 4 | **Pre-deploy hooks** | PASS | Migration service runs before main deploy. Failed hook aborts deploy, reverts git checkout. See `samples/hookapp/` |
| 5 | **Multi-compose overlay** | PASS | `compose: [base.yml, prod.yml]` merges correctly. Prod overrides apply (NODE_ENV, LOG_LEVEL). See `samples/multicompose/` |
| 6 | **Build args** | PASS | `build_args` passed as env vars during `docker compose build`. Values baked into image. See `samples/buildargapp/` |
| 7 | **Rollback** | PASS | `jib rollback` checks out `previous_sha`, rebuilds (or uses cached image), brings containers up. Health check verifies rollback worked. |
| 8 | **Health check failure** | PASS | Broken `/health` (500) detected after warmup + 5 retries with backoff. State records `failure`, increments `consecutive_failures`. |
| 9 | **Deploy over crash loop** | PASS | Container in restart loop detected via health check. Subsequent `jib deploy --force` with fixed code replaces the broken container. |
| 10 | **Dry-run** | PASS | `--dry-run` shows current/target SHA and what would happen without making changes. |

### Operational Commands

| # | Command | Result | Notes |
|---|---------|--------|-------|
| 11 | `jib status` | PASS | Shows all apps with SHA, status, failures, pinned state. Both table (all) and detail (single app) views. |
| 12 | `jib apps` | PASS | Lists apps with repo, branch, strategy, domains. |
| 13 | `jib logs <app>` | PASS | `--tail N` works. Shows all services interleaved. |
| 14 | `jib metrics <app>` | PASS | Live CPU/memory/network stats per container. |
| 15 | `jib doctor` | PASS | Checks deps (versions), secrets, SSL cert expiry. Reports missing rclone, missing certs. |
| 16 | `jib exec <app> <svc> -- <cmd>` | PASS | Runs in existing container (not PID 1). |
| 17 | `jib run <app> <svc> -- <cmd>` | PASS | Spawns new container (PID 1), auto-removed after exit. |
| 18 | `jib down <app>` | PASS | Stops and removes containers + network. State preserved. |
| 19 | `jib restart <app>` | PASS | Restarts containers without rebuild. |
| 20 | `jib add <app>` | PASS | Adds app to config.yml with `--repo`, `--domain`, `--health` flags. `--config-only` skips provisioning. |
| 21 | `jib secrets set/check` | PASS | Writes to `/opt/jib/secrets/<app>/.env` with 0700/0600 perms. |
| 22 | `jib env <app>` | PASS | Shows env vars with secrets redacted. |
| 23 | `jib cleanup` | PASS | Prunes unused Docker images. |
| 24 | `jib resume <app>` | PASS | Resets `pinned=false`, `consecutive_failures=0`. |
| 25 | `jib config list` | PASS | Shows full config with secrets redacted. |

### Infrastructure

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 26 | **Nginx proxy generation** | PASS | Per-domain conf with ACME challenge, proxy_pass, security headers. |
| 27 | **SSL-aware templates** | PASS | HTTP-only when cert missing, HTTPS when cert exists. No nginx test failure. |
| 28 | **SSL via certbot** | PASS | Obtained Let's Encrypt cert for `basilapp.co` through Cloudflare (webroot mode). |
| 29 | **Re-provision after domain change** | PASS | Stale nginx configs (old domain) are detected and removed. New domain config written. |
| 30 | **Concurrent deploys (flock)** | PASS | Two simultaneous `jib deploy` on same app: second waits for first to finish. No race condition. |
| 31 | **Cross-app Docker networking** | PASS | Apps isolated by default (`jib-<app>_default` network). Cross-app via `host.docker.internal` or manual `docker network connect`. |

## Bugs Found & Fixed

| # | Bug | Severity | Fix |
|---|-----|----------|-----|
| 1 | **Silent errors** — `SilenceErrors: true` + `os.Exit(1)` produced no error output | High | Print error to stderr before exit (`main.go`) |
| 2 | **Local repo deploy fails** — `git fetch origin` fails for repos without a remote | High | Added `gitHasRemote()` check, fall back to local HEAD (`deploy.go`) |
| 3 | **SSL-only nginx template** — Template always generated HTTPS blocks, failing `nginx -t` when certs don't exist | High | Added `HasSSL` conditional in template, auto-detect cert existence (`templates.go`, `nginx.go`) |
| 4 | **`provision` was a stub** — Printed "would do" instead of doing | Medium | Implemented real provisioning: generate configs, write, obtain SSL, reload nginx (`setup.go`) |
| 5 | **Stale nginx configs on domain change** — Re-provision left old domain's `.conf` files | Medium | Track previous domains in state file, diff and remove stale configs (`setup.go`) |

## Not Yet Tested

| Scenario | Reason |
|----------|--------|
| Blue-green strategy | Not implemented in deploy engine |
| Daemon autodeploy (`jib serve`) | Requires long-running process + git remote |
| Backup/restore | Requires rclone + R2/S3 bucket |
| Cron tasks | `jib cron` commands are stubs |
| `jib tunnel` | Requires Cloudflare Tunnel or Tailscale setup |
| `jib upgrade` | Requires release binary hosting |

## Sample Config

See `samples/config.yml` for a complete config exercising all tested features.

## Environment

- **Droplet**: DigitalOcean, 1 vCPU, 2GB RAM, 48GB disk, Ubuntu 24.04
- **Docker**: 28.2.2, Compose 2.37.1
- **Nginx**: 1.24.0
- **Certbot**: 2.9.0
- **Domain**: basilapp.co (Cloudflare DNS)
