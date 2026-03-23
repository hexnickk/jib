# Jib — Skill Reference for Claude Agents

You are operating `jib`, a lightweight Docker Compose deployment tool. Jib is a single Go binary that lives on the server. You interact with it via SSH or directly on the server shell.

## What Jib Does

Jib deploys docker-compose apps on bare Linux machines. It handles: git pull, docker build, docker compose up, health checks, rollback, nginx reverse proxy, SSL certs, secrets injection, and notifications. Designed for small teams running 3–7 apps per server.

## How to Run Commands

```bash
# Directly on the server
jib <command> [args] [flags]

# Remotely via SSH
ssh user@server jib <command> [args] [flags]
```

---

## Command Reference

### Deploying

| Command | What it does |
|---------|-------------|
| `jib deploy <app>` | Pull latest code, build, deploy, health check |
| `jib deploy <app> --ref <sha/tag/branch>` | Deploy a specific git ref |
| `jib deploy <app> --force` | Redeploy even if already at target SHA |
| `jib deploy <app> --dry-run` | Show what would happen, change nothing |
| `jib rollback <app>` | Swap to previous version (one level) |
| `jib resume <app>` | Reset failure counter, unpin, re-enable autodeploy |

**Deploy flow:** acquire lock → check disk space → validate secrets → git fetch/checkout → symlink secrets → generate override → docker compose build → run pre_deploy hooks → docker compose up → warmup → health check → update state → notify → prune images.

### Managing Apps

| Command | What it does |
|---------|-------------|
| `jib add <app> --repo org/name --domain host:port` | Add new app to config (**--repo and --domain are required**) |
| `jib add <app> ... --health /path:port` | Add with health check |
| `jib add <app> ... --compose file1,file2` | Add with multi-compose |
| `jib add <app> ... --config-only` | Write config only, skip provisioning |
| `jib remove <app> [--force]` | Remove app (containers, config, nginx) |
| `jib provision [app] [--skip-ssl]` | Regenerate nginx configs + SSL certs |
| `jib down <app>` | Stop containers, keep config |
| `jib restart <app>` | Restart containers without rebuild |

### Observing

| Command | What it does |
|---------|-------------|
| `jib status` | Table of all apps: SHA, status, failures, pinned |
| `jib status <app>` | Detailed single-app status |
| `jib status [app] --json` | JSON output |
| `jib apps` | List apps with repo, branch, strategy, domains |
| `jib logs <app> [service] [--tail N] [-f]` | Container logs (default tail 100) |
| `jib metrics [app] [--watch]` | Live CPU/memory/network stats |
| `jib env <app>` | Show env vars (secrets redacted) |
| `jib doctor` | Check deps, secrets, SSL certs |
| `jib history <app> [--json] [--limit N]` | Deploy timeline (not yet implemented) |

### Running Commands in Containers

| Command | What it does |
|---------|-------------|
| `jib exec <app> [service] -- <cmd>` | Run in existing container |
| `jib run <app> <service> [-- <cmd>]` | Run in new ephemeral container |

`exec` runs inside the already-running container. `run` creates a new container that is removed after the command exits. Use `exec` for debugging, `run` for one-off tasks like migrations.

### Secrets

| Command | What it does |
|---------|-------------|
| `jib secrets set <app> --file <path>` | Upload .env file to server |
| `jib secrets check [app]` | Verify secrets files exist |

Secrets are stored at `/opt/jib/secrets/<app>/.env` with 0700/0600 permissions. For secrets to be injected into containers:
1. Set `secrets_env: true` in the app config
2. Your `docker-compose.yml` must include `env_file: .env` in the service definition

Deploy will fail if `secrets_env: true` but the secrets file is missing. Jib creates a symlink from `/opt/jib/secrets/<app>/.env` into the repo directory at deploy time, so the compose file's `env_file: .env` resolves to the secrets file.

### Configuration

| Command | What it does |
|---------|-------------|
| `jib config list` | Show full config (secrets redacted) |
| `jib config get <key>` | Read a config value |
| `jib config set <key> <value>` | Write a config value (see caveat below) |
| `jib edit` | Open config in $EDITOR, validate on save |

Config lives at `/opt/jib/config.yml`.

**Caveat:** `jib config set` stores all values as strings. For boolean fields like `secrets_env`, this causes YAML parse errors (`cannot unmarshal !!str into bool`). Use `jib edit` instead to modify boolean or nested fields.

### Infrastructure

| Command | What it does |
|---------|-------------|
| `jib provision [app]` | Generate nginx configs + obtain SSL certs |
| `jib provision --skip-ssl` | Nginx only, skip certbot |
| `jib cleanup` | Prune unused Docker images and build cache |
| `jib serve` | Start daemon (autodeploy + backups + monitoring) |
| `jib upgrade` | Self-update jib binary |
| `jib nuke [--force]` | Remove ALL jib data from the machine |

### Notifications & Webhooks

| Command | What it does |
|---------|-------------|
| `jib notify setup <channel>` | Set up telegram/slack/discord/webhook |
| `jib notify test [channel]` | Send test notification |
| `jib notify list` | Show configured channels |
| `jib notify remove <channel>` | Remove a channel |
| `jib webhook setup` | Generate webhook secret + URL for GitHub |

### Backups

| Command | What it does |
|---------|-------------|
| `jib backup <app>` | Create backup of app volumes |
| `jib restore <app> [--from <ts>] [--dry-run] [--force]` | Restore from backup |
| `jib backup-dest setup [name]` | Configure backup destination (S3/R2) |
| `jib backup-dest list` | Show destinations |
| `jib backup-dest remove <name>` | Remove a destination |

Requires `rclone` installed. Check with `jib doctor`.

### Cron

| Command | What it does |
|---------|-------------|
| `jib cron add <app>` | Add scheduled task (interactive) |
| `jib cron list <app>` | List tasks |
| `jib cron run <app>` | Trigger task manually |
| `jib cron remove <app>` | Remove task |

---

## Config Schema

```yaml
config_version: 1
certbot_email: you@example.com

apps:
  myapp:
    repo: org/repo               # GitHub repo, or "local" (see Local Repos below)
    branch: main                 # Git branch (default: main)
    compose: docker-compose.yml  # Single file or list of files
    strategy: restart             # Deploy strategy (default: restart)
    health:                      # Health check endpoints
      - path: /health
        port: 3000
    warmup: "5s"                 # Wait before health checks
    domains:                     # Nginx reverse proxy mappings
      - host: example.com
        port: 3000
    secrets_env: true            # Inject /opt/jib/secrets/<app>/.env
    env_file: .env               # Name of secrets file (default: .env)
    pre_deploy:                  # Run before deploy (e.g., migrations)
      - service: migrations
    build_args:                  # Passed to docker compose build
      NODE_ENV: production
    services: [api, web]         # Subset of compose services to deploy
    nginx_include: infra/custom.conf  # Extra nginx directives
    cron:                        # Scheduled tasks
      - schedule: "0 9 * * *"
        service: api
        command: npm run digest
    backup:
      destination: primary
      schedule: "0 4 * * *"
      volumes: [db_data]
```

### Local Repos

When `repo: local`, jib skips `git fetch` and uses the existing repo at `/opt/jib/repos/<app>/`. Requirements:
- The directory must be a **git repository** (`git init`)
- It must have **at least one commit** (jib tracks deploy state by SHA)
- You manage the code yourself (copy files, git commit) — jib won't clone anything

This is useful for testing, single-server apps, or repos you sync manually.

## File System Layout

```
/opt/jib/
├── config.yml              # Main config
├── state/<app>.json        # Deploy state (SHA, status, failures)
├── secrets/<app>/.env      # App secrets (0700 dir, 0600 file)
├── repos/<app>/            # Git checkouts
├── overrides/<app>.yml     # Generated compose overrides
├── nginx/<domain>.conf     # Generated nginx configs
├── locks/<app>.lock        # Deploy locks (flock)
├── backups/                # Local backup tarballs
└── deploy-keys/<app>       # SSH deploy keys
```

## Docker Naming Convention

Containers: `jib-<app>-<service>-<N>` (e.g., `jib-fullstack-api-1`)
Networks: `jib-<app>_default`
Volumes: `jib-<app>_<volume>`

Each app gets its own isolated Docker network. Cross-app communication uses `host.docker.internal` or explicit `docker network connect`.

---

## Common Workflows

### First-time setup
```bash
jib init                    # Install deps, create config
jib add myapp --repo org/repo --domain example.com:3000 --health /health:3000
jib secrets set myapp --file .env    # If using secrets
jib deploy myapp
jib doctor                  # Verify everything
```

### Deploy cycle
```bash
jib deploy myapp                      # Deploy latest
jib status myapp                      # Check result
jib logs myapp --tail 50              # Verify logs
```

### Something broke
```bash
jib status myapp                      # Check failure count + error
jib logs myapp --tail 200             # Find the error
jib rollback myapp                    # Revert to previous version (resets failures)
# Fix the code, push, then:
jib deploy myapp                      # Deploy the fix
```

**When to use `jib resume`:** Rollback automatically resets the failure counter. Use `resume` when you want to re-enable autodeploy *without* rolling back — e.g., after fixing config/secrets and redeploying, or when the app auto-healed.

### Change domains
```bash
jib edit                              # Change domains in config
jib provision myapp                   # Regenerate nginx + SSL
```

### Secrets rotation
```bash
jib secrets set myapp --file new.env  # Upload new secrets
jib restart myapp                     # Pick up new env vars
```

---

## Troubleshooting

### Deploy fails silently
Run `jib deploy <app> --force` and read stderr. Jib prints errors to stderr.

### Deploy blocked by "secrets file missing"
The app has `secrets_env: true` but no secrets file exists. Fix:
```bash
jib secrets set <app> --file /path/to/.env
```

### Health check fails after deploy
The app started but the health endpoint isn't responding. Check:
1. `jib logs <app> --tail 100` — look for startup errors
2. `curl localhost:<port><health_path>` — test directly
3. Check `warmup` is long enough for the app to start

The deploy is recorded as a failure. If the app crashes on startup, the container will be in a restart loop (not running). If the app starts but returns unhealthy responses, containers stay running with bad code. Either way: fix the issue and redeploy, or `jib rollback`.

### "No previous deploy found" on rollback
There's only one deploy in history. Rollback requires at least two deploys.

### SSL certificate missing
```bash
jib provision <app>          # Attempts certbot
```
Requirements: DNS must point to the server, port 80 must be open, `certbot_email` must be set. If behind Cloudflare with proxy enabled, ensure the ACME challenge can reach the origin.

### Stale nginx config after domain change
```bash
jib provision <app>          # Detects and removes stale configs
```

### Containers crash-looping
Deploy a fix with `jib deploy <app> --force`. The `--force-recreate` flag on compose up replaces the broken containers.

### Concurrent deploy conflict
Jib uses file locks (`flock`). A second deploy on the same app waits for the first to finish (up to 5 min timeout). Autodeploy uses non-blocking locks and skips if locked.

### Disk space
Jib refuses to deploy with < 2GB free disk. Run `jib cleanup` to prune old images.

### rclone missing
Backups require rclone. Install: `curl https://rclone.org/install.sh | bash`, then `jib doctor` to verify.

### Need to run a database migration manually
```bash
jib run <app> <service> -- <migration command>
# e.g.: jib run myapp api -- npx prisma migrate deploy
```

### Need to inspect a running container
```bash
jib exec <app> <service> -- sh
# e.g.: jib exec myapp api -- sh
```
