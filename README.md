# Jib

A single Go binary that deploys docker-compose apps on bare machines with auto-SSL, autodeploy, backups, and basic monitoring. For small teams running 3-7 apps per machine.

Jib lives on the server. You SSH in and run commands, or use `ssh <host> jib <command>` from your laptop. No local install needed.

## Quick Start

```bash
# Install on a fresh Ubuntu 22.04+ server:
curl -fsSL https://get.jibdeploy.dev/install.sh | bash
jib init

# Add an app:
jib add myapp \
  --repo myorg/myapp \
  --compose docker-compose.yml \
  --domain myapp.com:3000 \
  --domain api.myapp.com:3001 \
  --health /health:3000

# Set secrets and deploy:
jib secrets set myapp --file .env.production
jib deploy myapp

# Check status:
jib status
jib doctor
```

## Commands

### Setup

| Command | Description |
|---|---|
| `jib init` | Interactive onboarding: install deps, create config, add first app |
| `jib add <app>` | Add an app (writes config + provisions infra) |
| `jib provision [app]` | Re-reconcile infra for an app or all apps (idempotent) |
| `jib remove <app>` | Remove an app |
| `jib edit` | Open config in `$EDITOR`, validate on save |

### Deploy

| Command | Description |
|---|---|
| `jib deploy <app> [--ref SHA] [--dry-run] [--force]` | Build and deploy |
| `jib rollback <app>` | Swap to previous version |
| `jib resume <app>` | Reset failures, unpin, re-enable autodeploy |

### Observe

| Command | Description |
|---|---|
| `jib status [app] [--json]` | Show status of all or one app |
| `jib apps` | List all apps with repo, branch, strategy, domains |
| `jib doctor` | Check deps, secrets, certs, containers |
| `jib logs <app> [service] [-f] [--tail N]` | Show container logs |
| `jib env <app>` | Show env vars (values redacted) |
| `jib metrics [app] [--watch]` | Live container stats (CPU, memory, network) |
| `jib history <app>` | Deploy/rollback/backup timeline |

### Operate

| Command | Description |
|---|---|
| `jib down <app>` | Stop containers without removing from config |
| `jib restart <app>` | Restart containers without redeploying |
| `jib exec <app> [service] -- <cmd>` | Execute command in running container |
| `jib run <app> <service> [-- <cmd>]` | Run a one-off command in a new container |
| `jib cleanup` | Prune old images and build cache |
| `jib secrets set <app> --file <path>` | Set secrets for an app |
| `jib secrets check [app]` | Verify secrets files exist |
| `jib backup <app>` | Create a backup of app data |
| `jib restore <app> --from <ts>` | Restore from a backup |
| `jib upgrade` | Self-update the jib binary |
| `jib nuke [--force]` | Remove everything jib-related |

### Config

| Command | Description |
|---|---|
| `jib config get <key>` | Read a config value (dot-notation: `apps.myapp.repo`) |
| `jib config set <key> <value>` | Write a config value |
| `jib config list` | Show full config |
| `jib notify setup <channel>` | Set up notifications (telegram/slack/discord/webhook) |
| `jib notify test [channel]` | Send test notification |
| `jib backup-dest setup [name]` | Configure backup destination (R2/S3) |

### Daemon

| Command | Description |
|---|---|
| `jib serve` | Start daemon (autodeploy polling, backups, health monitoring) |
| `jib webhook setup` | Generate secret for GitHub webhook instant deploys |

## Config

Lives at `/opt/jib/config.yml`:

```yaml
config_version: 1
poll_interval: 5m
certbot_email: you@example.com

github:
  app_id: 123456

backup_destinations:
  primary:
    driver: r2
    bucket: my-backups
    retain: 7
    local_retain: 3

apps:
  myapp:
    repo: myorg/myapp
    branch: main
    compose: docker-compose.yml
    strategy: restart                   # restart (default) | blue-green
    health:
      - path: /health
        port: 3000
      - path: /health
        port: 3001
    warmup: 10s
    pre_deploy:
      - service: migrations
    build_args:
      VITE_API_URL: https://api.myapp.com
    domains:
      - host: myapp.com
        port: 3000
      - host: api.myapp.com
        port: 3001
    nginx_include: infra/nginx/custom.conf
    backup:
      destination: primary
      schedule: "0 4 * * *"
      volumes: [db_data]
    secrets_env: true
    env_file: .env
    services: [api, web]
    cron:
      - schedule: "0 9 * * *"
        service: api
        command: npm run send-digest
```

Config is versioned (`config_version`). Jib auto-migrates old configs on load and refuses configs newer than the binary.

## Deploy Flow (restart strategy)

The default strategy. Brief downtime (seconds) during container swap. Works with shared volumes and migrations.

1. Acquire per-app file lock (flock)
2. Check disk space (abort if < 2GB free)
3. Validate secrets exist
4. `git fetch` + `git checkout <ref>`
5. Symlink secrets `.env` into repo
6. Generate compose override (labels, restart policy, log rotation)
7. `docker compose build`
8. Run pre-deploy hooks (e.g., migrations)
9. `docker compose up -d --force-recreate`
10. Wait for warmup, then health check all endpoints (5 retries with backoff)
11. Tag previous images as rollback
12. Update state, notify, prune old images

Rollback: `jib rollback` checks out previous SHA and restarts containers. If the rollback image is tagged, no rebuild needed.

## Docker Isolation

Every app is fully isolated via:

- **Project prefix**: All compose commands use `-p jib-<app>`, so containers, volumes, and networks are namespaced. Two apps defining `db_data` won't clash.
- **Generated override**: Jib auto-generates `/opt/jib/overrides/<app>.yml` with labels (`jib.app`, `jib.managed`), `unless-stopped` restart policy, and log rotation (50MB, 3 files). The user's compose file is never modified.

## Secrets

Secrets live at `/opt/jib/secrets/<app>/.env` with strict permissions (0700 dir, 0600 file). During deploy, jib symlinks the secrets file into the repo so docker-compose's `env_file: .env` just works.

```bash
jib secrets set myapp --file .env.production
jib secrets check
jib env myapp                       # shows KEY=redacted***
```

## SSL

Certs are obtained via certbot (webroot mode) and auto-renewed. `jib doctor` checks cert expiry and warns at < 14 days.

## Nginx

Per-domain config files are generated in `/opt/jib/nginx/` and symlinked to `/etc/nginx/conf.d/`. Each domain gets:
- HTTP server: ACME challenge + redirect to HTTPS
- HTTPS server: SSL, security headers (HSTS, X-Frame-Options, X-Content-Type-Options), proxy_pass

Custom nginx directives (rate limiting, CORS, websockets) can be included via `nginx_include` in the app config.

## Notifications

Multi-channel: Telegram, Slack, Discord, generic webhook. All optional. Credentials stored in `/opt/jib/secrets/_jib/`.

Events: deploy start/success/failure, rollback, container crash, cert expiry warning, disk > 90%.

## Health Checks

Multiple endpoints supported per app. Each endpoint is checked with 5 retries at 3s/6s/12s/24s/48s backoff after an optional warmup period.

```yaml
health:
  - path: /health
    port: 3000
  - path: /health
    port: 3001
```

## Filesystem Layout

```
/opt/jib/
├── config.yml
├── state/<app>.json                    # deploy state (atomic writes)
├── secrets/<app>/.env                  # app secrets (0700/0600)
├── secrets/_jib/                       # jib credentials (telegram, slack, etc.)
├── repos/<app>/                        # git checkouts
├── overrides/<app>.yml                 # generated compose overrides
├── nginx/<domain>.conf                 # generated nginx configs
├── backups/                            # local backup tarballs
├── locks/<app>.lock                    # flock files
└── deploy-keys/<app>                   # SSH keys (if not using GitHub App)
```

## Platform Support

Currently supports **Ubuntu 22.04+** only. The `internal/platform/` interface abstracts OS-specific operations (package management, service management, paths) so adding Debian, RHEL, or macOS is a matter of implementing the interface.

### Dependency Requirements

| Dependency | Minimum | Why |
|---|---|---|
| Docker Engine | 24.0 | Compose V2, `--remove-orphans` |
| Docker Compose | 2.20 | `--dry-run`, consistent `run --rm` |
| Nginx | 1.18 | `conf.d/` includes, SSL directives |
| Certbot | 2.0 | Webroot mode, Python 3 only |
| Rclone | 1.50 | R2/S3 provider support |
| Git | 2.25 | `ls-remote` with ref filtering |

Checked at `jib init` and `jib doctor`. Minimum versions only, no upper bounds.

## Architecture

```
cmd/jib/                    CLI entrypoint (cobra)
internal/
├── config/                 YAML config parsing + validation
├── state/                  State persistence (flock + atomic writes)
├── deploy/                 Deploy + rollback orchestration
├── docker/                 Compose wrappers, health checks, override generation
├── secrets/                Secrets management + symlinks
├── notify/                 Multi-channel notifications
├── proxy/                  Nginx config generation (Proxy interface)
├── ssl/                    Certbot wrapper + cert expiry
└── platform/               OS abstraction + dependency checks
```

## Building

```bash
make build          # produces bin/jib with embedded version
make install        # go install
make clean
```

## Multi-User

Anyone with SSH access can run `jib` commands. Config and state are shared.

```bash
ssh myserver jib status
ssh myserver jib deploy myapp
ssh myserver jib logs myapp api --tail 50
```

## License

MIT
