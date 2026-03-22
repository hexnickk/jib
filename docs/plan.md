# Jib — Lightweight Docker Compose Deploy Tool

## What

A single Go binary (`curl | bash` installable on the server) that deploys docker-compose apps on bare machines with zero-downtime (optional), auto-SSL, autodeploy, backups, and basic monitoring. For small teams running 3-7 apps per machine.

**Jib lives on the server.** You SSH in and run commands, or use `ssh <host> jib <command>` from your laptop. No local install needed. Config, state, and secrets all live on the machine — single source of truth, no sync problems, multi-user just works.

## Why — The Problem Today

Deploying docker-compose apps to a VPS is a pile of manual scripts, SSH sessions, and nginx configs. Here's what it looks like today for two real projects on the same machine:

### Current: spatialkitten (Whisker)

```bash
# To deploy — SSH in and run:
ssh spatialkittens
cd ~/projects/uhdann/spatialkitten
git pull origin main
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps backend frontend
docker image prune -f

# SSL — was a separate one-time script:
# scripts/init-nginx.sh — installs certbot, copies nginx configs, gets certs

# Autodeploy — a custom systemd service (whisker-autodeploy) that polls origin/main

# Nginx — hand-written, manually placed in /etc/nginx/sites-enabled/whisker
# If it breaks, SSH in and debug
```

### Current: propertyclerk

```bash
# To deploy — SSH in and run:
ssh spatialkittens
cd ~/projects/chaindynamicsltd/propertyclerk-ui
git pull origin main
docker compose build
docker compose run --rm migrations
docker compose up -d --force-recreate --no-deps api web
docker image prune -f

# SSL — was supposed to use init-nginx.sh but it didn't exist yet
# Result: propertyclerk.app showed spatialkittens.com content for days
# because nginx configs were hand-placed with HTTP-only blocks and no SSL

# Nginx — two conf files in infra/nginx/, manually scp'd to the server
# The full SSL versions existed in the repo but weren't deployed
```

### What Goes Wrong

- **No SSL on propertyclerk** — nginx configs in the repo had 443 blocks but only HTTP-only versions were deployed. Both domains showed the same site.
- **No zero-downtime** — `docker compose up --force-recreate` has a gap where containers restart.
- **No rollback** — bad deploy? SSH in, figure out the previous commit, revert manually.
- **No backups** — SQLite database in a docker volume. If the volume is lost, data is gone.
- **No monitoring** — find out something's broken when users complain or you happen to check.
- **Nginx configs drift** — repo has one version, server has another. No one notices until it breaks.
- **Each app reinvents deploy** — separate `deploy.sh`, `init-nginx.sh`, `autodeploy.sh` per project. Slight differences cause bugs.

### With Jib

```bash
# Install jib on a fresh server:
curl -fsSL https://jib.hexnickk.sh/install.sh | bash
jib init

# Add an app:
jib add propertyclerk \
  --repo chaindynamicsltd/propertyclerk-ui \
  --compose docker-compose.yml \
  --domain propertyclerk.app:3010 \
  --domain api.propertyclerk.app:3011 \
  --health /health:3010 \
  --health /health:3011

# Deploy:
jib deploy propertyclerk              # build, migrate, swap
jib deploy whisker --ref abc123       # specific SHA

# Something broke:
jib rollback propertyclerk            # swap to previous version, seconds

# Check what's going on:
jib status                            # all apps, certs, disk, backups
jib logs propertyclerk api -f         # tail api container logs
jib logs propertyclerk --deploy       # deploy history

# Debug:
jib exec propertyclerk api -- sh      # shell into running container
jib run propertyclerk api -- npm run seed  # one-off command

# Health check:
jib doctor                            # is everything working?

# Everything else is automatic:
# - autodeploy polls main, deploys on new commits
# - SSL certs obtained and renewed automatically
# - backups uploaded to R2 nightly
# - alerts on: failed deploy, cert expiry, disk full, container crash
```

## Architecture

Jib is installed **on the server only**. All commands run locally on the machine. Users interact via SSH.

```
jib (Go binary, installed on server at /usr/local/bin/jib)

# Setup
├── jib init                            # interactive onboarding: deps, user, config, first app
├── jib add <app>                       # add app: config + clone + key + nginx + SSL (all-in-one)
├── jib provision [app]                 # re-reconcile infra for app (or all) — idempotent
├── jib remove <app>                    # remove an app
├── jib edit                            # $EDITOR config.yml + validate on save

# Config (read/write settings without re-running init)
├── jib config get <key>                # read a config value
├── jib config set <key> <value>        # write a config value
├── jib config list                     # show all config (secrets redacted)
├── jib notify setup <channel>          # interactive setup for telegram|slack|discord|webhook
├── jib notify test [channel]           # send test notification
├── jib notify remove <channel>         # remove a notification channel
├── jib notify list                     # show configured channels + status
├── jib backup-dest setup [name]        # interactive backup destination setup
├── jib backup-dest remove <name>       # remove a backup destination
├── jib backup-dest list                # show configured destinations

# Deploy
├── jib deploy <app> [--ref SHA] [--dry-run]
├── jib rollback <app>
├── jib resume <app>                    # reset failures, unpin, re-enable autodeploy
├── jib webhook setup                   # generate secret, print GitHub webhook URL

# Observe
├── jib status [app] [--json]
├── jib logs <app> [service] [-f] [--tail N]
├── jib history <app>                   # deploy/rollback/backup timeline
├── jib env <app>                       # show env vars (secrets redacted)
├── jib apps                            # list all apps with status summary
├── jib doctor                          # check everything: nginx, docker, serve, certs, secrets

# Operate
├── jib down <app>                      # stop containers without removing app from config
├── jib restart <app>                   # restart containers without redeploying
├── jib exec <app> [service] -- <cmd>
├── jib run <app> <service> [-- <cmd>]
├── jib backup <app>
├── jib restore <app> --from <ts>
├── jib cleanup
├── jib secrets set <app> --file <path>
├── jib secrets check [app]
├── jib cron <app> add/list/remove/run  # scheduled tasks per app
├── jib metrics [app] [service]         # live container stats (cpu, mem, net)
├── jib tunnel setup                    # interactive Cloudflare Tunnel or Tailscale setup
├── jib tunnel status                   # tunnel connection status
├── jib upgrade                         # self-update jib binary
├── jib nuke [--confirm]                # remove everything jib-related from the machine

# Daemon
└── jib serve                           # autodeploy + backups + monitoring
```

### Two-Layer Separation

1. **Tool** — `jib` binary at `/usr/local/bin/jib`. Versioned with embedded version string.
2. **Data** — `/opt/jib/` on the server. Contains config, state, secrets, repos, logs, nginx configs, backups, deploy keys.

### Multi-User

Anyone with SSH access can run `jib` commands. Config and state are shared.

```bash
# From your laptop:
ssh houseview jib status
ssh houseview jib deploy propertyclerk
ssh houseview jib logs propertyclerk api --tail 50

# Or alias:
alias jh="ssh houseview jib"
jh status
jh deploy propertyclerk
```

## Config

Lives on the server at `/opt/jib/config.yml`. Edited via `jib edit`, `jib add`, or directly.

### Config Versioning & Migrations

Config files include a `config_version` field at the top. Jib uses this to detect outdated configs and migrate them forward automatically.

```yaml
config_version: 1   # ← incremented when the config schema changes
```

**How it works:**

1. Every config file has a `config_version` integer (defaults to 1 if missing).
2. Jib knows the latest config version (compiled into the binary).
3. On `LoadConfig`, if `config_version < latest`:
   - Run each migration function in order (e.g., `migrateV1toV2`, `migrateV2toV3`).
   - Each migration transforms the YAML structure, adds new fields with defaults, renames/removes deprecated fields.
   - Write the migrated config back to disk with the new `config_version`.
   - Print what changed: `"Config migrated from v1 to v2: added 'webhook' section with defaults"`.
4. If `config_version > latest` (newer config than binary): refuse to operate, print `"Config version 3 is newer than this jib binary supports (v2). Run 'jib upgrade' first."`.
5. Migrations are in `internal/config/migrate.go` — one function per version bump, tested independently.

**When to bump config_version:**
- Adding a required field (migration adds it with a default)
- Renaming a field (migration renames it)
- Changing field semantics (migration transforms values)
- Removing a field (migration deletes it)

**When NOT to bump:**
- Adding an optional field with a sensible zero-value (existing configs just work)
- Adding a new app (that's `jib add`, not a schema change)

```yaml
# /opt/jib/config.yml

config_version: 1
poll_interval: 5m
certbot_email: nick@hexnickk.sh

# GitHub App for repo access (preferred over deploy keys)
github:
  app_id: 123456
  # private key at /opt/jib/secrets/_jib/github-app-key.pem

backup_destinations:
  primary:
    driver: r2                          # r2 | s3
    bucket: jib-backups
    retain: 7
    local_retain: 3
    # encrypt: true                     # opt-in, off by default
    # gpg_key_id: "ABCD1234"

apps:
  propertyclerk:
    repo: chaindynamicsltd/propertyclerk-ui
    branch: main
    compose: docker-compose.yml         # string or list
    # compose:                          # override files:
    #   - docker-compose.yml
    #   - docker-compose.prod.yml
    strategy: restart                   # restart (default) | blue-green
    health:                              # single or list of endpoints
      - path: /health
        port: 3010
      - path: /health
        port: 3011
    warmup: 10s
    pre_deploy:
      - service: migrations             # run to completion before starting app
    build_args:                         # passed to docker compose build
      VITE_API_URL: https://api.propertyclerk.app
    domains:
      - host: propertyclerk.app
        port: 3010
      - host: api.propertyclerk.app
        port: 3011
    nginx_include: infra/nginx/custom.conf  # optional custom directives (from repo)
    backup:
      destination: primary
      schedule: "0 4 * * *"
      volumes: [db_data]
      hook: scripts/backup.sh
    secrets_env: true
    env_file: .env                      # symlink target filename (default: .env)
    services: [api, web]                # which services to start (default: all)

  whisker:
    repo: uhdann/spatialkitten
    branch: main
    compose: docker-compose.prod.yml
    strategy: blue-green                # stateless frontend, benefits from zero-downtime
    health:
      - path: /health
        port: 3001
    warmup: 15s
    domains:
      - host: whisker.spatialkittens.com
        port: 3001
    backup:
      destination: primary
      schedule: "0 4 * * *"
      volumes: [whisker_db]
    secrets_env: true
```

### `jib init` — Interactive Onboarding

Runs automatically after `curl | bash` install, or manually anytime. Walks through setup step by step. Every question has a sane default or can be skipped — press Enter to accept defaults.

```
$ jib init

Welcome to Jib! Let's set up your server.

── System Setup ──────────────────────────────────────────

[1/4] Installing dependencies...
  ✓ Docker (already installed, v24.0.7 — minimum: v24.0)
  ✓ Nginx (installing... v1.24.0 — minimum: v1.18)
  ✓ Certbot (installing... v2.7.0 — minimum: v2.0)
  ✓ Rclone (installing... v1.65.0 — minimum: v1.50)

[2/4] Creating deploy user...
  ✓ User 'deploy' created, added to docker group

[3/4] Configuring Docker...
  ✓ Log rotation: json-file, max-size 50m, max-file 3

[4/4] Hardening SSH...
  ✓ PasswordAuthentication no
  ✓ PermitRootLogin no

── Configuration ─────────────────────────────────────────

Autodeploy poll interval? [5m]:
Email for SSL certificates? []: nick@hexnickk.sh

── GitHub Access ─────────────────────────────────────────

How do you want to access repos?
  1. GitHub App (recommended for multiple repos)
  2. Deploy keys (one per repo)
  3. Skip for now

Choice [1]: 1

GitHub App ID? []: 123456
Path to GitHub App private key? []: /tmp/app-key.pem
  ✓ GitHub App configured

── Deploy Trigger ────────────────────────────────────────

How should deploys trigger?
  1. Polling (check every 5m, zero setup)
  2. GitHub webhooks (instant, needs webhook URL)
  3. Both (webhook + polling as fallback)

Choice [1]: 3
  ✓ Polling every 5m (fallback)
  ✓ Webhook secret generated
  ✓ After setup, add this webhook to GitHub:
    URL:    https://<any-domain>/_jib/webhook
    Secret: ghw_abc123...

── Notifications (all optional, press Enter to skip) ────

Telegram bot token? []:
Telegram chat ID? []:
Slack webhook URL? []:
Discord webhook URL? []:

── Tunnel (for home servers / no public IP) ──────────────

Is this server behind NAT / no public IP?
  1. No, it has a public IP (VPS, cloud)
  2. Yes, set up Cloudflare Tunnel
  3. Yes, set up Tailscale
  4. Skip for now

Choice [1]:

── Backups (optional, press Enter to skip) ───────────────

Set up backups?
  1. Cloudflare R2
  2. AWS S3
  3. Skip for now

Choice [3]: 1

R2 bucket name? []: jib-backups
R2 access key? []: ***
R2 secret key? []: ***
Keep last N remote backups? [7]:
Keep last N local backups? [3]:
  ✓ Backup destination 'primary' configured

── First App ─────────────────────────────────────────────

Add your first app now?
  (you can always add more later with `jib add`)

App name? []: propertyclerk
GitHub repo (org/name)? []: chaindynamicsltd/propertyclerk-ui
Branch? [main]:
Compose file? [docker-compose.yml]:
Domain(s)? (host:port, comma-separated) []: propertyclerk.app:3010, api.propertyclerk.app:3011
Health check path:port? [/health:3010]:
Needs .env secrets? [y]:

  ✓ App added to config
  ✓ Repo cloned
  ✓ Nginx configs generated
  ✓ SSL certs obtained
  ✗ Secrets missing — run: jib secrets set propertyclerk --file .env

Add another app? [n]:

── Done! ─────────────────────────────────────────────────

  ✓ Config written to /opt/jib/config.yml
  ✓ jib serve started (systemd)

Next steps:
  jib secrets set propertyclerk --file .env.production
  jib deploy propertyclerk
  jib status
```

Key principles:
- Every question has a default or "skip" option
- System setup (docker, nginx) runs first with no questions — just progress
- Optional sections (notifications, backups) are clearly skippable
- First app setup flows into `jib add` logic
- Ends with concrete next steps
- Idempotent: running `jib init` again skips completed steps
- **Existing nginx detection**: if nginx is already installed and has existing configs in `/etc/nginx/`, `jib init` warns and asks before proceeding. Jib's generated configs go in `/opt/jib/nginx/` and are symlinked into `/etc/nginx/conf.d/` — they coexist with existing configs as long as there are no domain conflicts. If a domain conflict is detected (existing config serves the same `server_name`), jib prints the conflict and asks the user to resolve it before continuing.

### Config Validation (`jib validate`)

- Domain names: RFC 1123 regex
- Ports: integer 1-65535
- App names: `[a-z0-9-]+`
- `health[].path`: must start with `/`, no absolute URLs (prevents SSRF)
- `health[].port`: integer 1-65535
- `hook`: relative path within repo, must be allowlisted in config
- Required fields validated with clear error messages
- If config missing: print "run `jib init` to get started"

### `jib add` — Adding a New App

All-in-one: writes config AND provisions infra:

```bash
jib add propertyclerk \
  --repo chaindynamicsltd/propertyclerk-ui \
  --compose docker-compose.yml \
  --domain propertyclerk.app:3010 \
  --domain api.propertyclerk.app:3011 \
  --health /health:3010 \
  --health /health:3011
```

This:
1. Adds app to `/opt/jib/config.yml`
2. If GitHub App configured → authenticate. Else → generate deploy key, print public key, wait for user.
3. Clones repo
4. Generates nginx configs
5. Gets SSL certs via certbot
6. Reloads nginx
7. Checks secrets → prompts if missing

If any step fails (e.g. certbot fails because DNS isn't propagated), the config is still written. Run `jib provision propertyclerk` later to retry the failed infra steps. Provision is idempotent — skips what's already done.

For power users: `jib add --config-only` writes to config without provisioning. Then `jib edit` + `jib provision` when ready.

```bash
# Alternative: edit config directly + reconcile
jib edit                              # opens $EDITOR, validates on save
jib provision propertyclerk           # retry/reconcile infra
```

### `jib provision` — Reconcile Infra

```bash
jib provision                         # reconcile all apps
jib provision propertyclerk           # reconcile one app
```

For each app, idempotently:
1. If GitHub App configured → authenticate. If deploy keys → generate key, print public key for user to add.
2. Clone repo (if not cloned)
3. Generate nginx configs for each domain
4. Get SSL certs via certbot (if not already obtained)
5. Reload nginx
6. Check secrets exist → warn if missing

Safe to run repeatedly. Skips steps already done.

## Deploy Strategies

### `restart` (default) — Simple, Fast, Works with Everything

The default. Build while old containers serve, then fast swap (seconds of downtime). Works with shared volumes, migrations, everything.

**The flock is held for the entire sequence (steps 1-17).** This prevents concurrent deploys (manual or autodeploy) from racing between build and up.

```
1. Acquire flock on /opt/jib/locks/<app>.lock (blocking with 5m timeout)
   - Manual deploys: block and wait (print "Waiting for lock...")
   - Autodeploy: non-blocking — skip if held
2. Check disk space (abort if < 2GB free)
3. Validate secrets exist if secrets_env: true
4. cd /opt/jib/repos/<app>
5. git fetch origin <branch>
6. git checkout <ref> (default: origin/<branch> HEAD)
7. Symlink secrets .env into repo
8. docker compose -p jib-<app> build (with build_args if configured)
9. Run pre_deploy hooks (e.g. docker compose -p jib-<app> run --rm migrations)
   - If any hook exits non-zero → git checkout <previous_sha> to restore repo state, notify, release lock, exit 1
10. docker compose -p jib-<app> up -d --force-recreate --remove-orphans [services]
    (if `services` configured, only start those — avoids starting migrations service)
11. Wait for warmup
12. Health check (see Health Checks below)
13. If healthcheck fails → notify, log error
    (containers are running but unhealthy — manual intervention needed.
     Previous image is kept for rollback.)
14. Update state (deployed_sha, previous_sha, timestamps, trigger, user)
15. Release lock
16. Notify (success)
17. docker image prune — keep previous image explicitly tagged as <app>:rollback (see Rollback Image Retention below)
```

#### Rollback Image Retention

After each successful deploy, jib explicitly tags the previous image as `<app>:rollback` before pruning. This ensures rollback never requires a rebuild:

```
docker tag <previous-image> propertyclerk:rollback
docker image prune -f   # safe — rollback image is tagged and won't be pruned
```

Rollback for `restart` strategy: `jib rollback` checks out `previous_sha`, starts containers from the `<app>:rollback` tagged image (no rebuild needed), and runs healthcheck. Brief downtime. If the rollback image was manually removed, falls back to checkout + rebuild.

### `blue-green` — Zero-Downtime (opt-in, Phase 4)

For apps that need true zero-downtime. Uses external Docker volumes (shared across slots) and a Docker network for nginx routing. Opt-in via `strategy: blue-green`.

Uses a **Docker network** instead of host port mapping to avoid port conflicts. Nginx connects to containers by Docker DNS name, not localhost ports.

```
1. Acquire flock on /opt/jib/locks/<app>.lock (blocking with timeout)
2. Check disk space (abort if < 2GB free)
3. Validate secrets exist if secrets_env: true
4. Read state → determine inactive slot (if blue active, deploy to green)
5. cd /opt/jib/repos/<app>
6. git fetch origin <branch>
7. git checkout <ref>
8. Symlink secrets .env into repo
9. docker compose -p <app>-<slot> build (with build_args if configured)
10. docker compose -p <app>-<slot> up -d (on jib network)
11. Wait for warmup
12. Health check against container on jib network (not host port)
13. If healthcheck fails → docker compose -p <slot> down, notify, release lock, exit 1
14. Update nginx upstream to point to new slot → nginx -t → nginx -s reload
15. If nginx -t fails → tear down new slot, notify, release lock, exit 1
16. docker compose -p <app>-<old_slot> down (keep image!)
17. Update state
18. Release lock, notify
19. Prune images older than 2 deploys ago (keep rollback image)
```

Rollback for `blue-green`: spin up previous slot, swap nginx, tear down current. No rebuild needed if image exists.

### Docker Network for Blue-Green

Jib creates a shared Docker network (`jib-net`) during `jib init`. Blue-green apps join this network. Nginx connects to containers by service name on the jib network, not by host port.

```nginx
# For blue-green apps, nginx upstream uses Docker DNS:
upstream propertyclerk-web {
    server propertyclerk-blue-web:3000;  # ← swapped to green on deploy
}
```

For `restart` strategy apps, standard host port mapping is used (simpler, no network complexity).

### Why Two Strategies?

| | `restart` | `blue-green` |
|---|---|---|
| Downtime | Brief (seconds) | Zero |
| Shared volumes | Works | Broken (each slot gets own volumes) |
| Migrations | Run before start, naturally | Complex (which DB do you migrate?) |
| Memory | 1x | 2x during deploy |
| Rollback speed | Instant (tagged image) | Instant (swap nginx) |
| Complexity | Low | Medium |

**Default is `restart`** because it works with everything — shared volumes, migrations, stateful apps. Downtime is only seconds (build happens while old containers serve). Blue-green is opt-in (Phase 4) for apps needing true zero-downtime, using external volumes shared across slots.

### Docker Isolation

Jib must coexist with any existing Docker containers, volumes, and networks on the machine. It achieves this through strict namespacing:

**Project names**: All compose commands use `-p jib-<app>` (e.g., `docker compose -p jib-propertyclerk`). This prefixes all container names, networks, and volumes with `jib-<app>-`, preventing clashes with non-jib containers or between jib apps.

```
# Two apps both define "db_data" volume and "default" network — no conflict:
jib-propertyclerk-db_data        # volume for propertyclerk
jib-whisker-db_data              # volume for whisker
jib-propertyclerk-default        # network for propertyclerk
jib-whisker-default              # network for whisker
```

**Networks**: Each app gets its own compose-managed network (`jib-<app>-default`). For blue-green, jib also creates `jib-net` (shared network for nginx → container routing). Non-jib containers on other networks are unaffected.

**Cleanup safety**: `jib cleanup` only prunes images/containers/volumes prefixed with `jib-`. Never touches non-jib resources. `jib nuke` only tears down `jib-*` projects.

**Existing Docker**: `jib init` does not modify Docker daemon config (no changes to `/etc/docker/daemon.json`). It only configures log rotation if no config exists yet. If Docker is already configured, it's left alone.

### Health Checks

Health checks support multiple endpoints. Apps with multiple services (e.g. `api` on port 3010, `web` on port 3011) can check all of them:

```yaml
health:                              # single or list
  - path: /health
    port: 3010
  - path: /health
    port: 3011
```

Shorthand for single-endpoint apps:

```yaml
health:
  - path: /health
    port: 3001
```

During deploy, **all** health endpoints must pass. For each endpoint:
- `GET http://localhost:<port><path>` (restart strategy) or via Docker network (blue-green)
- Retry with backoff: max 5 attempts at 3s/6s/12s/24s/48s intervals
- Any endpoint failing = entire health check fails

The `warmup` field is a sleep before the first health check attempt, giving containers time to start up (e.g. JVM warmup, DB connection pool init).

## State Schema

```json
// /opt/jib/state/<app>.json — atomic writes (tmp + mv), flock per-app
{
  "schema_version": 1,
  "app": "propertyclerk",
  "strategy": "restart",
  "deployed_sha": "abc123def456...",
  "previous_sha": "789abc012...",
  "active_slot": "blue",
  "pinned": false,
  "last_deploy": "2026-03-21T04:00:00Z",
  "last_deploy_status": "success",
  "last_deploy_error": "",
  "last_deploy_trigger": "manual",
  "last_deploy_user": "nick",
  "consecutive_failures": 0,
  "last_backup": "2026-03-21T04:00:00Z",
  "last_backup_status": "success",
  "slots": {
    "blue": {
      "sha": "abc123def456...",
      "project_name": "propertyclerk-blue",
      "deployed_at": "2026-03-21T04:00:00Z"
    },
    "green": {
      "sha": "789abc012...",
      "project_name": "propertyclerk-green",
      "deployed_at": "2026-03-20T12:00:00Z"
    }
  }
}
```

- `schema_version` — binary refuses to operate on newer state
- `pinned` — autodeploy skips (set by `--ref`, cleared by `jib resume`)
- `last_deploy_trigger` — "manual" | "autodeploy"
- `last_deploy_user` — `$USER` or "autodeploy"
- `slots` — only used for blue-green strategy; restart strategy ignores this

## Secrets

Secrets never go in config. They live at `/opt/jib/secrets/` with strict permissions.

```bash
# Install app secrets:
jib secrets set propertyclerk --file .env.production
# → copies to /opt/jib/secrets/propertyclerk/.env, chmod 600

# Verify all apps have their secrets:
jib secrets check

# View env vars (values redacted):
jib env propertyclerk
# → DATABASE_URL=file:./sto***, RESEND_API_KEY=re_***, ...
```

During deploy, jib symlinks `/opt/jib/secrets/propertyclerk/.env` → `/opt/jib/repos/propertyclerk/.env` so docker-compose's existing `env_file: .env` just works. The symlink is recreated on every deploy (after git checkout, before build).

Layout:

```
/opt/jib/secrets/                       # 700, deploy:deploy
├── _jib/
│   ├── telegram.env                    # TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
│   ├── slack_webhook                   # Slack incoming webhook URL
│   ├── discord_webhook                 # Discord webhook URL
│   ├── webhook_url                     # generic webhook URL
│   ├── rclone.conf                     # backup credentials
│   └── github-app-key.pem             # GitHub App private key (if using)
├── propertyclerk/.env
└── whisker/.env
```

## Machine Filesystem Layout

```
/opt/jib/
├── config.yml
├── state/
│   ├── propertyclerk.json
│   └── whisker.json
├── secrets/                            # 700
│   ├── _jib/
│   ├── propertyclerk/.env
│   └── whisker/.env
├── repos/
│   ├── propertyclerk/
│   └── whisker/
├── logs/
│   ├── deploys/                        # per-app deploy logs
│   └── jib-serve.log
├── nginx/                              # generated, symlinked to /etc/nginx/conf.d/
│   ├── propertyclerk.app.conf
│   ├── api.propertyclerk.app.conf
│   └── whisker.spatialkittens.com.conf
├── backups/                            # local tarballs (local_retain applies)
├── locks/                              # flock files per app
└── deploy-keys/                        # 700 (only if not using GitHub App)
    ├── propertyclerk
    └── whisker
```

## Key Mechanics

### Pre-Deploy Hooks (Migrations)

Apps often need to run migrations before the new version starts. Config:

```yaml
apps:
  propertyclerk:
    pre_deploy:
      - service: migrations             # run docker compose run --rm migrations
```

In the deploy flow, after `git checkout` and `docker compose build`, but before `docker compose up -d`:

```
# For each pre_deploy entry:
docker compose run --rm <service>
# If exit code != 0 → abort deploy, notify, release lock
```

This matches propertyclerk's existing pattern where `api` depends on `migrations` completing.

### Build Args

Some values are needed at build time (e.g. `VITE_API_URL` for Vite SPA):

```yaml
apps:
  propertyclerk:
    build_args:
      VITE_API_URL: https://api.propertyclerk.app
```

Passed to compose as: `VITE_API_URL=https://api.propertyclerk.app docker compose build`

These are not secrets (they're baked into the image). Actual secrets go in `.env`.

### Custom Nginx Directives

Generated nginx configs cover the common case. For rate limiting, CORS, websocket upgrade, etc.:

```yaml
apps:
  propertyclerk:
    nginx_include: infra/nginx/custom.conf  # path in repo, included in server block
```

Generated config includes it:

```nginx
server {
    listen 443 ssl;
    server_name propertyclerk.app;
    # ... standard jib-generated config ...

    include /opt/jib/repos/propertyclerk/infra/nginx/custom.conf;
}
```

The include file is part of the repo, so it's version-controlled and deployed with the app.

### Compose Override Files

Support single file or list:

```yaml
apps:
  whisker:
    compose: docker-compose.prod.yml

  propertyclerk:
    compose:
      - docker-compose.yml
      - docker-compose.prod.yml
```

Jib passes them as: `docker compose -f docker-compose.yml -f docker-compose.prod.yml build`

### Rollback

**For `restart` strategy:**
```
1. Acquire flock
2. Read state → get previous_sha
3. If no previous deploy → exit "No previous deploy found"
4. If previous_sha still in git → checkout, rebuild, deploy (brief downtime)
5. If force-pushed away → exit with error
6. Release lock, notify
```

**For `blue-green` strategy:**
```
1. Acquire flock
2. Read state → find previous slot
3. If previous slot image exists → start it, healthcheck, swap nginx, stop current
4. If previous slot image pruned → fall back to restart-style rollback
5. Release lock, notify
```

### Deploy Dry-Run

```bash
jib deploy propertyclerk --dry-run
```

Output:
```
DRY RUN — propertyclerk (restart strategy)
  Current: abc123f (deployed 2h ago by nick)
  Target:  def456a (origin/main, 3 commits ahead)

  Commits:
    def456a fix: handle empty response in property search
    bcd234e feat: add bulk import endpoint
    abc890d chore: update dependencies

  Pre-deploy: migrations service will run
  Build args: VITE_API_URL=https://api.propertyclerk.app
  Nginx: no config changes
  Secrets: ✓ present

  Would run:
    git checkout def456a
    docker compose build
    docker compose run --rm migrations
    docker compose up -d --force-recreate
```

### Autodeploy (jib serve)

Two modes: **polling** (default, zero setup) and **webhooks** (instant, requires inbound access).

#### Polling (default)

```
Every poll_interval:
  For each app in config:
    1. If state.pinned == true → skip
    2. timeout 30s: git ls-remote origin <branch> → remote_sha
    3. If timeout/error → log, skip, continue
    4. Compare with state.deployed_sha
    5. If same → skip
    6. If consecutive_failures >= 3 → skip, log, notify (once per hour)
    7. Acquire flock (non-blocking — skip if held)
    8. Run deploy flow (trigger = "autodeploy")
    9. On failure: increment consecutive_failures, notify
    10. On success: reset consecutive_failures
```

#### Webhooks (instant deploys)

`jib serve` can optionally listen for GitHub webhook push events. Deploys trigger instantly on push instead of waiting for the poll interval.

Config:

```yaml
webhook:
  enabled: true
  port: 9090                            # internal port jib listens on
  # secret in /opt/jib/secrets/_jib/webhook_secret
```

Setup:

```bash
# 1. Generate a webhook secret:
jib webhook setup
#   ✓ Secret generated and saved to /opt/jib/secrets/_jib/webhook_secret
#
#   Add this webhook to your GitHub repos:
#     URL:    https://propertyclerk.app/_jib/webhook
#             (or any domain pointing to this server)
#     Secret: ghw_abc123...
#     Events: Push events only
#
#   Or for all repos at once (GitHub org-level webhook):
#     URL:    https://propertyclerk.app/_jib/webhook
#     Secret: ghw_abc123...

# 2. Add webhook in GitHub (repo Settings → Webhooks → Add)
#    Or org-level: github.com/organizations/<org>/settings/hooks
```

Nginx routes `/_jib/webhook` on any managed domain to jib's internal webhook port:

```nginx
# Auto-added to every domain's nginx config:
location = /_jib/webhook {
    proxy_pass http://127.0.0.1:9090;
}
```

When GitHub sends a push event:
1. Verify HMAC signature with the shared secret
2. Extract repo + branch from payload
3. Match to an app in config
4. If matched → trigger deploy immediately (same flow as polling)
5. If no match → ignore (200 OK, no action)

One webhook URL works for all repos — jib routes by repo name from the payload. Org-level webhook = set it once, all repos covered.

**Polling and webhooks can coexist.** Webhook for instant deploys, polling as fallback (catches anything webhooks missed). If webhook is enabled, you can increase `poll_interval` to `30m` or `1h` since it's just a safety net.

`jib resume <app>` resets failures + pinned flag.

### Backups

The backup flock is shared with the deploy flock. This means backup and deploy cannot run concurrently for the same app. Behavior when contending:
- **Scheduled backup** while deploy is running: non-blocking — skip, retry next schedule.
- **Manual `jib backup`** while deploy is running: block and wait with message "Waiting for deploy to finish..."
- **Manual `jib deploy`** while backup is running: block and wait with message "Waiting for backup to finish..." (with 5m timeout).
- **Autodeploy** while backup is running: non-blocking — skip, will retry next poll.

```
Per schedule (via jib serve):
  0. Acquire flock (non-blocking for scheduled backups, blocking for manual)
  1. If backup.hook exists in repo:
     a. docker compose run --rm <service> <hook>
     b. If non-zero → abort, notify, release lock
  2. For each volume:
     a. docker run --rm -v <volume>:/data -v /opt/jib/backups:/backup alpine \
        tar czf /backup/<app>-<volume>-<timestamp>.tar.gz -C /data .
  3. sha256sum > <tarball>.sha256
  4. If encrypt: true → gpg --encrypt --recipient <gpg_key_id>
  5. rclone copy to destination bucket
  6. If upload ok → prune local beyond local_retain
  7. If upload fail → keep local, log, notify
  8. Prune remote beyond retain
  9. Update state, release lock
```

Encryption is opt-in, off by default. Most setups just use bucket-level access control.

### Restore

```
jib restore <app> --from <timestamp>:
  1. List available backups (remote + local)
  2. Download from remote (or use local)
  3. If encrypted → decrypt with GPG key
  4. Verify sha256 checksum
  5. Acquire flock
  6. Safety backup: tar current volumes locally first
  7. Stop containers
  8. Restore volumes from tarball
  9. Start containers
  10. Healthcheck
  11. If unhealthy → warn, print path to safety backup
  12. Update state, release lock, notify
```

Step 6-7 has downtime. Intentional — restoring into running containers risks corruption.

### SSL

```
On `jib provision`:
  1. Generate HTTP-only nginx conf (/.well-known/acme-challenge/ only)
  2. nginx -t && nginx -s reload
  3. certbot certonly --webroot -w /var/www/certbot --email <certbot_email> for each domain
  4. Generate full SSL nginx conf with security headers
  5. nginx -t && nginx -s reload
  6. Add certbot renewal cron (if not exists)

Monitoring (via jib serve):
  - Check cert expiry via openssl
  - Warn + notify if < 21 days
  - Alert if < 7 days
```

Future consideration: Caddy as alternative proxy (auto-SSL, eliminates certbot entirely). The proxy interface in `internal/proxy/` supports this swap.

### GitHub App Authentication

Preferred over deploy keys for multi-repo setups:

```bash
# One-time setup:
# 1. Create GitHub App at github.com/settings/apps
# 2. Grant repo access to your orgs/repos
# 3. Download private key

jib secrets set _jib/github-app-key.pem --file /tmp/app-key.pem

# Add to config:
jib edit
# github:
#   app_id: 123456
```

Jib generates short-lived installation tokens from the app key. No static deploy keys to manage. Adding a new repo = grant the app access on GitHub (one click), no server-side changes.

Fallback: if no GitHub App configured, `jib provision` generates ed25519 deploy keys per repo and prints the public key for the user to add to GitHub.

### Notifications

Multi-channel, all optional. If no tokens/URLs configured, nothing sends.

Config:

```yaml
notifications:
  telegram:
    # token + chat_id in /opt/jib/secrets/_jib/telegram.env
    # TELEGRAM_BOT_TOKEN=xxx
    # TELEGRAM_CHAT_ID=xxx
  slack:
    # webhook URL in /opt/jib/secrets/_jib/slack_webhook
  discord:
    # webhook URL in /opt/jib/secrets/_jib/discord_webhook
  webhook:
    # generic webhook in /opt/jib/secrets/_jib/webhook_url
```

All channels receive the same events:
- Deploy start/success/failure
- Rollback start/success/failure
- Restart (container bounce)
- Container crash / unhealthy / OOM killed
- Container auto-restart (by Docker restart policy)
- Backup success/failure
- Cert expiry warning (< 21 days)
- Disk > 90%
- `jib serve` started/stopped
- Autodeploy paused (consecutive failures)

Payload: `{ app, event, sha, trigger, user, status, error, timestamp, machine }`

Telegram messages are formatted as markdown. Slack/Discord use their native webhook format. Generic webhook gets raw JSON POST.

Each channel is independent — if Telegram token exists, it sends. If Slack webhook exists, it sends. Multiple channels at once is fine. Add new channels by implementing the `Notifier` interface in `internal/notify/`.

### Config & Notify CLI — Managing Settings After Init

Everything configured during `jib init` can be changed later via CLI without re-running init.

#### `jib config` — Read/Write Config Values

```bash
# Read:
jib config get poll_interval              # → 5m
jib config get certbot_email              # → nick@hexnickk.sh
jib config get apps.propertyclerk.branch  # → main

# Write (validates, updates config.yml, reloads jib serve if running):
jib config set poll_interval 10m
jib config set certbot_email nick@example.com

# List all:
jib config list
#   poll_interval: 5m
#   certbot_email: nick@hexnickk.sh
#   github.app_id: 123456
#   apps: propertyclerk, whisker
#   notifications: telegram ✓, slack ✗, discord ✗
#   backup_destinations: primary (r2)
```

Dot-notation for nested keys. Validates the same way `jib edit` does — rejects invalid values with a clear error. If `jib serve` is running, it picks up config changes automatically (watches file or receives SIGHUP).

#### `jib notify` — Notification Channel Management

```bash
# Interactive setup (prompts for tokens/URLs, sends test message):
jib notify setup telegram
#   Telegram bot token? []: 123456:ABC-DEF
#   Telegram chat ID? []: -1001234567890
#   ✓ Credentials saved to /opt/jib/secrets/_jib/telegram.env
#   Sending test notification...
#   ✓ Test message sent — check your Telegram

jib notify setup slack
#   Slack incoming webhook URL? []: https://hooks.slack.com/services/T.../B.../xxx
#   ✓ Saved to /opt/jib/secrets/_jib/slack_webhook
#   ✓ Test message sent

jib notify setup discord
#   Discord webhook URL? []: https://discord.com/api/webhooks/...
#   ✓ Saved to /opt/jib/secrets/_jib/discord_webhook
#   ✓ Test message sent

jib notify setup webhook
#   Webhook URL? []: https://example.com/hook
#   ✓ Saved to /opt/jib/secrets/_jib/webhook_url
#   ✓ Test POST sent (200 OK)

# Test without re-setup:
jib notify test                           # test all configured channels
jib notify test telegram                  # test one channel

# List configured channels:
jib notify list
#   telegram: ✓ configured (chat: -1001234567890)
#   slack:    ✗ not configured
#   discord:  ✓ configured
#   webhook:  ✗ not configured

# Remove a channel:
jib notify remove telegram
#   ✓ Telegram credentials removed
```

#### `jib backup-dest` — Backup Destination Management

```bash
# Interactive setup:
jib backup-dest setup primary
#   Driver? [r2]: r2
#   R2 bucket name? []: jib-backups
#   R2 access key? []: ***
#   R2 secret key? []: ***
#   Keep last N remote backups? [7]:
#   Keep last N local backups? [3]:
#   ✓ Backup destination 'primary' configured
#   ✓ rclone credentials saved

# List destinations:
jib backup-dest list
#   primary: r2 (jib-backups), retain: 7 remote / 3 local

# Remove:
jib backup-dest remove primary
#   ✓ Backup destination 'primary' removed
```

All three sub-commands (`config`, `notify`, `backup-dest`) follow the same pattern: they modify `/opt/jib/config.yml` and/or `/opt/jib/secrets/_jib/` and validate changes. `jib serve` picks up changes without restart.

### Tunnels (Cloudflare / Tailscale)

For home servers behind NAT or without a public IP. Jib can set up and manage tunnels so your apps are accessible via public domains without port forwarding.

Config:

```yaml
tunnel:
  provider: cloudflare                  # cloudflare | tailscale
  # Cloudflare: token in /opt/jib/secrets/_jib/cloudflare_tunnel.env
  #   CLOUDFLARE_TUNNEL_TOKEN=xxx
  # Tailscale: auth key in /opt/jib/secrets/_jib/tailscale.env
  #   TAILSCALE_AUTH_KEY=xxx
```

#### `jib tunnel setup` — Interactive Setup

Cloudflare Tunnels are notoriously fiddly. `jib tunnel setup` walks through it:

```
$ jib tunnel setup

Which tunnel provider?
  1. Cloudflare Tunnel (public domains, free)
  2. Tailscale Funnel (Tailscale network, or public via Funnel)

Choice [1]: 1

── Cloudflare Tunnel Setup ───────────────────────────────

Steps:
  1. Go to https://one.dash.cloudflare.com → Networks → Tunnels
  2. Create a tunnel, name it (e.g. "houseview")
  3. Copy the tunnel token

Tunnel token? []: eyJh...

  ✓ Token saved to /opt/jib/secrets/_jib/cloudflare_tunnel.env
  ✓ cloudflared installed
  ✓ cloudflared service started

Now configure DNS routes in Cloudflare dashboard:
  propertyclerk.app        → http://localhost:3010
  api.propertyclerk.app    → http://localhost:3011
  whisker.spatialkittens.com → http://localhost:3001

Or jib can configure routes automatically if you provide an API token:
Cloudflare API token (optional, for auto-DNS)? []:

  ✓ DNS routes configured for all app domains

── Done! ─────────────────────────────────────────────────
  ✓ Tunnel active: houseview
  ✓ All domains routed through tunnel

  jib tunnel status    — check tunnel health
```

Tailscale setup:

```
$ jib tunnel setup

Choice: 2

── Tailscale Setup ───────────────────────────────────────

Tailscale auth key? []: tskey-auth-xxx
  ✓ Tailscale installed and connected

Enable Tailscale Funnel for public access?
  (exposes services to the internet via your Tailscale domain)
  [y/N]: y

  ✓ Funnel enabled for:
    https://houseview.tailnet-name.ts.net → http://localhost:3010

Note: Tailscale Funnel uses *.ts.net domains.
For custom domains, use Cloudflare Tunnel instead.
```

#### How Tunnels Interact with Nginx

With tunnels, nginx still runs locally as the reverse proxy. The tunnel connects to nginx on port 80/443. The flow:

```
Internet → Cloudflare Tunnel → localhost:443 → Nginx → container:port
Internet → Tailscale Funnel → localhost:443 → Nginx → container:port
```

SSL: With Cloudflare Tunnel, SSL terminates at Cloudflare's edge — nginx can serve HTTP internally. With Tailscale Funnel, Tailscale handles SSL. In both cases, certbot is optional (only needed if you want local SSL too).

`jib tunnel status`:
```
$ jib tunnel status
  Provider: Cloudflare Tunnel
  Status:   connected
  Tunnel:   houseview (abc123)
  Routes:
    propertyclerk.app        → http://localhost:3010 ✓
    api.propertyclerk.app    → http://localhost:3011 ✓
    whisker.spatialkittens.com → http://localhost:3001 ✓
```

### Scheduled Tasks (Cron)

Run recurring commands inside app containers. For digest emails, cleanup jobs, report generation, etc.

```bash
# Add a scheduled task:
jib cron propertyclerk add "0 9 * * *" api -- npm run send-digest
jib cron propertyclerk add "0 3 * * 0" api -- npm run cleanup-expired

# List tasks:
jib cron propertyclerk list
#   0 9 * * *   api: npm run send-digest     (last: 9h ago ✓)
#   0 3 * * 0   api: npm run cleanup-expired (last: 3d ago ✓)

# Run one manually:
jib cron propertyclerk run 1

# Remove:
jib cron propertyclerk remove 1
```

Config (also configurable via `jib cron add`):

```yaml
apps:
  propertyclerk:
    cron:
      - schedule: "0 9 * * *"
        service: api
        command: npm run send-digest
      - schedule: "0 3 * * 0"
        service: api
        command: npm run cleanup-expired
```

`jib serve` runs cron tasks on schedule via `docker compose run --rm <service> <command>`. On failure: logs error, notifies. Task history stored in state.

### Metrics

Live container resource usage:

```bash
$ jib metrics
propertyclerk
  api:  CPU 2.3%   Mem 145MB/512MB (28%)   Net I/O 1.2MB/3.4MB
  web:  CPU 0.1%   Mem  32MB/256MB (12%)   Net I/O 0.5MB/1.1MB

whisker
  backend:   CPU 5.1%   Mem 310MB/1GB (31%)   Net I/O 4.5MB/12MB
  frontend:  CPU 0.3%   Mem  48MB/256MB (19%)   Net I/O 0.8MB/2.1MB

Machine: CPU 12%  Mem 1.8GB/4GB (45%)  Disk 23GB free (55%)

$ jib metrics propertyclerk api      # specific service
$ jib metrics --watch                # live updating (like htop)
```

Wraps `docker stats` with jib's app/service awareness. No historical data — for that, use external monitoring (Grafana/Prometheus). `jib doctor` warns if any container is consistently above 90% memory.

### Status & Monitoring

```bash
$ jib status
Machine: houseview (jib v0.3.1, serve: running)
  Disk: 45% (23GB free)  Memory: 62%  Containers: 6 running

propertyclerk (restart)              whisker (blue-green)
  SHA:     abc123 (main)               SHA:     def456 (main)
  Deploy:  2h ago (autodeploy)         Slot:    blue
  Health:  ✓ all domains               Deploy:  1d ago (nick)
  SSL:     67d remaining               Health:  ✓ all domains
  Backup:  6h ago ✓                    SSL:     52d remaining
                                       Backup:  6h ago ✓
```

`jib serve` continuously:
- Container health every 60s
- Alerts: container crash, disk > 90%, cert < 21 days, backup age > 25h
- Optional dead man's switch (healthchecks.io URL in `_jib/healthcheck_url`)
- `jib-serve.log` rotated by logrotate (configured during `jib init`)

### Doctor

```bash
$ jib doctor
  ✓ Docker: running (v24.0.7, minimum: v24.0)
  ✓ Docker Compose: v2.24.0 (minimum: v2.20)
  ✓ Nginx: running, config valid (v1.24.0, minimum: v1.18)
  ✓ Certbot: v2.7.0 (minimum: v2.0)
  ✓ Rclone: v1.65.0 (minimum: v1.50)
  ✓ Git: v2.39.0 (minimum: v2.25)
  ✓ jib serve: active (pid 1234)
  ✓ propertyclerk: 2 containers healthy
  ✓ propertyclerk: secrets present
  ✓ propertyclerk: SSL cert valid (67d)
  ✓ propertyclerk: last backup 6h ago
  ✗ whisker: secrets missing — run: jib secrets set whisker --file .env
  ✓ whisker: 2 containers healthy
  ✓ whisker: SSL cert valid (52d)
  ✓ Disk: 45% used (23GB free)
```

### Logs

Container stdout/stderr:

```bash
jib logs propertyclerk                  # all services, last 100 lines
jib logs propertyclerk api              # specific service
jib logs propertyclerk api -f           # follow
jib logs propertyclerk --tail 200       # last N lines
```

### History

Deploy/rollback/backup audit trail:

```bash
$ jib history propertyclerk

2026-03-22 14:30  ✓ deploy    abc123→def456  autodeploy  (3 commits)
2026-03-22 10:15  ✓ deploy    789abc→abc123  nick        (1 commit)
2026-03-21 23:50  ✗ deploy    789abc→failed  autodeploy  migrations failed
2026-03-21 18:00  ✓ deploy    456def→789abc  nick --ref  (pinned)
2026-03-21 12:00  ⏪ rollback  789abc→456def  nick
2026-03-21 04:00  ✓ backup    db_data        scheduled

$ jib history propertyclerk --limit 5    # last N events
$ jib history propertyclerk --json       # structured output
```

Stored in `/opt/jib/logs/deploys/<app>.jsonl` — one JSON entry per event, rendered as a table for humans.

### Down (stop without removing)

```bash
jib down propertyclerk               # stop all containers for app
jib down propertyclerk api           # stop specific service
```

Stops containers without removing the app from config. Useful for maintenance windows, debugging, or freeing resources temporarily. The app stays in config — `jib deploy` or `jib restart` brings it back up. Autodeploy (via `jib serve`) will **not** restart a downed app; use `jib resume` to re-enable.

### Restart (without redeploy)

```bash
jib restart propertyclerk             # restart containers at current SHA
```

For when you changed env vars or secrets and just want to bounce containers. Doesn't pull code, doesn't build, doesn't run migrations. Just `docker compose restart [services]` (or `down` + `up` with `--force`).

### Exec & Run

```bash
jib exec propertyclerk api -- sh
jib run propertyclerk migrations
jib run propertyclerk api -- npm run seed
```

### Cleanup

```bash
jib cleanup
```
- Prune images older than 2 deploys ago (never prune rollback image)
- Prune stopped containers
- Prune orphaned volumes (never named app volumes)
- Prune local backup tarballs beyond `local_retain`
- Prune deploy logs older than 30 days
- Report disk space reclaimed

### Self-Update

```bash
jib upgrade
```
- Download latest from GitHub releases
- Verify SHA256 checksum
- Replace `/usr/local/bin/jib`
- Restart `jib serve`
- Print old → new version

## Nginx Config Generation

Per-domain conf files in `/opt/jib/nginx/` symlinked to `/etc/nginx/conf.d/`.

Go's `text/template` (not envsubst). All inputs validated before interpolation.

Example for restart strategy (host port mapping):

```nginx
# /opt/jib/nginx/propertyclerk.app.conf — generated by jib, do not edit
server {
    listen 80;
    server_name propertyclerk.app;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name propertyclerk.app;

    ssl_certificate     /etc/letsencrypt/live/propertyclerk.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/propertyclerk.app/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Custom directives from repo (if nginx_include configured)
    include /opt/jib/repos/propertyclerk/infra/nginx/custom.conf;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Example for blue-green strategy (Docker network):

```nginx
upstream whisker-web {
    server whisker-blue-frontend:3000;  # swapped to green on deploy
}

server {
    listen 443 ssl;
    server_name whisker.spatialkittens.com;
    # ... SSL + headers ...

    location / {
        proxy_pass http://whisker-web;
        # ... headers ...
    }
}
```

Proxy abstraction (`internal/proxy/`) defines an interface. Only nginx now. Caddy possible later.

## Install

```bash
curl -fsSL https://jib.hexnickk.sh/install.sh | bash
```

1. Detect OS + arch (ubuntu/amd64, ubuntu/arm64 — Phase 1)
2. Verify Ubuntu (abort with message on unsupported OS — see Platform Support below)
3. Download binary from GitHub releases
4. Verify SHA256 checksum
5. Install to `/usr/local/bin/jib`
6. Automatically run `jib init` (interactive onboarding)

## Platform Support

**Phase 1: Ubuntu only** (22.04+ LTS). The install script verifies Ubuntu and aborts with a clear message on other platforms. All system interactions assume `apt`, `systemd`, and standard Ubuntu paths.

To support future platforms without rewriting core logic, system-specific operations are isolated behind an `internal/platform/` interface from day 1:

```go
// internal/platform/platform.go
type Platform interface {
    InstallPackage(name string) error          // apt install, brew install, dnf install
    IsPackageInstalled(name string) bool
    PackageVersion(name string) (string, error) // installed version string
    StartService(name string) error            // systemctl start, launchctl load
    StopService(name string) error
    EnableService(name string) error           // systemctl enable, launchctl bootstrap
    ServiceStatus(name string) (string, error)
    InstallServiceUnit(name, content string) error  // write systemd unit, launchd plist
    NginxConfigDir() string                    // /etc/nginx/conf.d, /opt/homebrew/etc/nginx/servers
    CertbotWebroot() string
}
```

Phase 1 implements only `UbuntuPlatform`. The interface exists so adding new platforms doesn't require touching deploy, proxy, SSL, or serve code.

### Future Platform Roadmap

| Phase | Platform | Notes |
|---|---|---|
| Phase 1 | Ubuntu 22.04+ (amd64, arm64) | `apt`, `systemd`. Primary target. |
| Future | Debian 12+ | Minimal delta from Ubuntu — same `apt` + `systemd`. |
| Future | Fedora / RHEL / Rocky | `dnf` instead of `apt`, same `systemd`. |
| Future | macOS (Mac Mini servers) | `brew` for packages, `launchd` instead of `systemd`, Docker Desktop or Colima instead of Docker Engine. Nginx paths differ (`/opt/homebrew/etc/nginx/`). No certbot needed if using Cloudflare Tunnel. |
| Future | Alpine | `apk`, OpenRC instead of `systemd`. Common in cloud VMs. |

### What Changes Per Platform

| Concern | Ubuntu | macOS | Debian/RHEL |
|---|---|---|---|
| Package manager | `apt` | `brew` | `apt` / `dnf` |
| Service manager | `systemd` | `launchd` | `systemd` |
| Docker | Docker Engine | Docker Desktop / Colima | Docker Engine |
| Nginx paths | `/etc/nginx/conf.d/` | `/opt/homebrew/etc/nginx/servers/` | `/etc/nginx/conf.d/` |
| File locking | `flock` | `flock` | `flock` |
| User creation | `useradd` | `sysadminctl` / `dscl` | `useradd` |

### Design Constraints for Cross-Platform

These rules apply from Phase 1 to avoid platform-specific assumptions leaking into core code:

1. **Never hardcode paths** — use `Platform.NginxConfigDir()` etc. instead of `/etc/nginx/conf.d/`
2. **Never call `apt` directly** — use `Platform.InstallPackage()`
3. **Never call `systemctl` directly** — use `Platform.StartService()` etc.
4. **Docker and docker compose commands are the same everywhere** — no abstraction needed
5. **`/opt/jib/` as data dir is fine everywhere** — macOS supports `/opt/` (created by Homebrew), and it avoids `~/` permissions issues

## Dependency Versions

Jib enforces **minimum versions only** — no upper bounds, no pinning. If an installed version meets the minimum, jib uses it as-is and does not upgrade or downgrade.

| Dependency | Minimum | Why this version |
|---|---|---|
| Docker Engine | 24.0 | Compose V2 as `docker compose` (not `docker-compose`), `--remove-orphans` support |
| Docker Compose | 2.20 | `--dry-run` support, consistent `run --rm` behavior |
| Nginx | 1.18 | `conf.d/` include pattern, `ssl_certificate` directive stability |
| Certbot | 2.0 | `--webroot` mode, `certonly` subcommand, Python 3 only |
| Rclone | 1.50 | R2/S3 provider support |
| Git | 2.25 | `ls-remote` with ref filtering |

Checked at two points:
1. **`jib init`** — installs missing deps, then verifies versions. If already installed but below minimum: print clear error with upgrade instructions, abort.
2. **`jib doctor`** — re-verifies all dependency versions. Reports outdated deps as warnings.

Version requirements are defined in a single `internal/platform/deps.go` file — one place to update when requirements change.

No upper bound because:
- The commands jib uses (`docker compose up`, `nginx -t`, `certbot certonly`) have stable CLIs across major versions
- Pinning creates false failures on machines with newer-than-expected packages
- If a future version breaks jib, that's a jib bug to fix in a release, not something to prevent with version capping

## Go Package Structure

```
jib/
├── cmd/
│   └── jib/
│       └── main.go               # CLI entrypoint (cobra)
├── internal/
│   ├── config/                    # parsing + validation
│   ├── state/                     # read/write with flock + atomic writes
│   ├── deploy/                    # restart + blue-green strategies
│   ├── rollback/
│   ├── proxy/                     # interface + nginx implementation
│   ├── backup/                    # backup + restore + drivers
│   ├── ssl/                       # certbot wrapper
│   ├── serve/                     # daemon: autodeploy + backups + health
│   ├── notify/                    # multi-channel: telegram, slack, discord, webhook
│   ├── secrets/
│   ├── doctor/                    # health checks
│   ├── tunnel/                    # cloudflare tunnel + tailscale setup/management
│   ├── cron/                      # scheduled task management
│   ├── metrics/                   # docker stats wrapper
│   ├── github/                    # GitHub App token generation
│   ├── platform/                  # OS abstraction: ubuntu (Phase 1), future: debian, rhel, macos
│   └── docker/                    # docker/compose wrappers
├── scripts/
│   └── install.sh
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

## Build Phases

### Phase 1 — Core (get propertyclerk deploying, Ubuntu only)
- [ ] CLI skeleton with cobra + embedded version
- [ ] `internal/platform/` interface + `UbuntuPlatform` implementation
- [ ] Dependency version checks (`internal/platform/deps.go`) — minimum versions for Docker, Compose, Nginx, Certbot, Rclone, Git
- [ ] `jib init` — interactive onboarding: deps, user, config, notifications, backups, first app (Ubuntu only)
- [ ] `jib add <app>` — add to config (flags or interactive)
- [ ] `jib provision [app]` — clone, GitHub App / deploy key, nginx, SSL
- [ ] `jib edit` + `jib validate`
- [ ] `jib config get/set/list` — read/write config values via CLI
- [ ] `jib notify setup/test/remove/list` — manage notification channels
- [ ] `jib backup-dest setup/remove/list` — manage backup destinations
- [ ] Config parsing + validation (strict from day 1)
- [ ] Config versioning (`config_version` field) + migration framework (`internal/config/migrate.go`)
- [ ] State management with flock + atomic writes + schema version
- [ ] `jib deploy <app>` with `restart` strategy — build, pre_deploy hooks, up, healthcheck
- [ ] `jib deploy --ref SHA` — pin + deploy specific ref
- [ ] `jib deploy --dry-run`
- [ ] `jib rollback <app>`
- [ ] `jib resume <app>`
- [ ] Nginx config generation (per-domain, Go templates, custom includes)
- [ ] SSL setup (certbot, part of `jib provision`)
- [ ] `jib status [--json]`
- [ ] `jib secrets set/check`
- [ ] `jib env <app>`
- [ ] `jib logs <app> [service] [-f] [--tail N]`
- [ ] `jib history <app>` — deploy/rollback/backup timeline
- [ ] `jib restart <app>` — bounce containers without redeploy
- [ ] `jib down <app>` — stop containers without removing from config
- [ ] `jib exec`, `jib run`
- [ ] `jib apps` — list all apps with status summary
- [ ] `jib doctor`
- [ ] Build args support
- [ ] Compose override files support
- [ ] `services` field — control which services start (avoid starting migrations service)
- [ ] `env_file` field — configurable symlink target filename

### Phase 2 — Automation
- [ ] `jib serve` — autodeploy polling with failure backoff + pinned skip
- [ ] `jib webhook setup` — inbound GitHub webhooks for instant deploys
- [ ] Webhook listener in `jib serve` (HMAC verification, repo matching)
- [ ] Notification channels (Telegram, Slack, Discord, generic webhook)
- [ ] `jib upgrade` — self-update + restart
- [ ] GitHub App authentication (token generation from app key)

### Phase 3 — Backup & Monitoring
- [ ] `jib backup <app>` — tar + checksum + upload (shares deploy flock)
- [ ] `jib restore <app> --from <ts>` — download + verify + safety backup + restore
- [ ] Backup hooks (run in container, abort on non-zero)
- [ ] Backup scheduling in `jib serve`
- [ ] Health monitoring + cert expiry in `jib serve`
- [ ] Dead man's switch support
- [ ] Optional GPG encryption (opt-in)

### Phase 4 — Tunnels, Cron & Metrics
- [ ] `jib tunnel setup` — interactive Cloudflare Tunnel / Tailscale setup
- [ ] `jib tunnel status`
- [ ] Tunnel-aware nginx config (skip certbot when tunnel handles SSL)
- [ ] `jib cron add/list/remove/run` — scheduled tasks per app
- [ ] Cron execution in `jib serve`
- [ ] `jib metrics [app] [--watch]` — live container stats

### Phase 5 — Polish & Blue-Green
- [ ] `blue-green` deploy strategy + Docker network
- [ ] Blue-green rollback (instant nginx swap)
- [ ] `jib cleanup` — safe pruning
- [ ] `jib remove <app>`
- [ ] `jib nuke` — clean removal
- [ ] `curl | bash` installer with checksum verification
- [ ] Release automation (GitHub Actions)

### Phase 6 — Platform Expansion
- [ ] `DebianPlatform` — minimal delta from Ubuntu (same `apt` + `systemd`)
- [ ] `FedoraPlatform` / `RHELPlatform` — `dnf` package manager, same `systemd`
- [ ] `MacOSPlatform` — `brew` packages, `launchd` service manager, Docker Desktop/Colima, Homebrew nginx paths
- [ ] Platform-specific install script logic (detect OS, route to correct platform)
- [ ] CI matrix testing across supported platforms

## Idempotency & Safety

**Every command is safe to re-run.** Running the same command twice should produce the same result, not break things.

- `jib init` — skips steps already done (docker installed? skip. deploy user exists? skip.)
- `jib add <app>` — if app already in config, prints "already exists, use `jib edit`"
- `jib provision` — skips: repo already cloned, key already generated, cert already obtained, nginx already configured
- `jib deploy <app>` — if already at target SHA, prints "already deployed at <sha>" and exits 0. `--dry-run` available.
- `jib provision` — `--dry-run` shows what would be done. `--force` re-runs SSL even if cert exists.
- `jib restore` — `--dry-run` downloads and verifies backup without restoring.
- `jib secrets set` — overwrites existing secrets (idempotent)
- `jib backup` — always creates a new backup (safe to run multiple times)
- `jib restore` — prompts for confirmation before stopping containers. Use `--force` to skip.
- `jib cleanup` — always safe (never touches rollback images or named app volumes)
- `jib upgrade` — if already latest, prints "already up to date"

**`--force` flag** overrides safety checks:

```bash
jib deploy propertyclerk --force        # deploy even if already at target SHA
jib restore propertyclerk --force       # skip confirmation prompt
jib remove propertyclerk --force        # skip confirmation, remove immediately
jib nuke --force                        # skip confirmation
```

Without `--force`, destructive operations require interactive confirmation.

## Nuke

```bash
jib nuke
```

Removes everything jib-related from the machine:

```
1. Confirm: "This will remove all jib data, stop all managed containers, and remove nginx configs. Type 'nuke' to confirm:"
2. Stop jib serve systemd service
3. For each app:
   a. docker compose down (both slots if blue-green)
   b. Remove nginx configs from /etc/nginx/conf.d/
4. nginx -s reload
5. Remove /opt/jib/ entirely (config, state, secrets, repos, logs, backups, keys)
6. Remove /usr/local/bin/jib
7. Remove systemd service file
8. Print: "Jib removed. Docker, nginx, and certbot are still installed."
```

Does NOT remove: docker, nginx, certbot, the deploy user, SSL certs in `/etc/letsencrypt/`. Those are system-level and may be used by other things.

`jib nuke --force` skips the confirmation prompt.

## Decisions Made

1. **Server-only**: Jib lives on the server. No local install, no sync.
2. **`restart` as default strategy**: Works with everything. Seconds of downtime. Blue-green opt-in in Phase 4 with external volumes.
3. **Docker network for blue-green**: Avoids port conflicts. Nginx routes by Docker DNS name, not host ports.
4. **GitHub App preferred**: One auth for all repos. Deploy keys as fallback.
5. **Secrets via symlink**: `.env` symlinked into repo dir. Compose `env_file: .env` just works.
6. **Build args in config**: Covers VITE_API_URL and similar build-time values.
7. **Pre-deploy hooks**: Run services (e.g. migrations) to completion before starting the app.
8. **Custom nginx via include**: Escape hatch for rate limiting, CORS, websockets. File lives in repo.
9. **Compose override files**: `compose` field accepts string or list.
10. **Encryption opt-in**: Backups unencrypted by default. Bucket-level access control is sufficient for most.
11. **`jib add` is all-in-one**: Writes config AND provisions infra. `jib provision` exists as retry/reconcile for failed steps. `--config-only` for power users.
12. **`--dry-run`**: See what would happen before doing it.
13. **`jib doctor`**: One command to check everything.
14. **Proxy abstraction**: Interface for nginx, future Caddy support.
15. **Healthcheck target**: Hit container ports directly, not through nginx. Multiple endpoints supported — all must pass.
16. **Idempotent commands**: Every command safe to re-run. `--force` overrides safety checks.
17. **`jib nuke`**: Clean removal of everything jib-related. Doesn't touch system packages.
18. **`jib restart`**: Bounce containers without redeploy. For env/secret changes.
19. **`services` field**: Control which services `up -d` starts. Prevents migrations service from starting unnecessarily.
20. **`env_file` configurable**: Symlink target filename defaults to `.env` but configurable per app.
21. **Rollback image tagged explicitly**: Previous image tagged as `<app>:rollback` before pruning — rollback never requires a rebuild.
22. **`jib down`**: Stop containers without removing from config. Autodeploy won't restart downed apps.
23. **Flock held for entire deploy**: No gap between build and up — prevents concurrent deploy races.
24. **Existing nginx coexistence**: Jib's configs symlinked into `conf.d/`, coexist with existing configs. Domain conflicts detected and flagged.
25. **Ubuntu-first, platform interface from day 1**: All OS-specific calls go through `internal/platform/`. Only `UbuntuPlatform` in Phase 1. Adding Debian/RHEL/macOS later doesn't touch core logic.
26. **Everything from init is CLI-manageable**: `jib config`, `jib notify`, `jib backup-dest` let you change any setting configured during init without re-running it. `jib serve` picks up changes automatically.
27. **Docker isolation via project prefix**: All compose commands use `-p jib-<app>`, namespacing containers, volumes, and networks. Two apps defining `db_data` volume won't clash. Non-jib Docker resources are never touched.
28. **Config versioning**: `config_version` integer in config file. Jib auto-migrates old configs forward on load. Refuses to run if config is newer than binary. Migrations are explicit functions, one per version bump, tested independently.
