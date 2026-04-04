# Jib

A single Go binary that deploys docker-compose apps on bare machines with auto-SSL, autodeploy, backups, and basic monitoring. For small teams running 3-7 apps per machine.

Jib lives on the server. You SSH in and run commands, or use `ssh <host> jib <command>` from your laptop. No local install needed.

## Quick Start

```bash
# Install on a fresh Ubuntu 22.04+ server (installs + runs jib init):
curl -fsSL https://raw.githubusercontent.com/hexnickk/jib/refs/heads/main/install.sh | bash

# Add an app (port and health check inferred from docker-compose.yml):
jib add myapp --repo myorg/myapp --domain myapp.com

# Set secrets and deploy:
jib secrets set myapp --file .env.production
jib deploy myapp
```

## What Can You Deploy?

**Frontend + Backend + Database** — a React app, Node API, and Postgres with persistent volumes, all in one compose file. Jib builds, deploys, health-checks, and reverse-proxies each domain.

**Multiple backends talking to each other** — deploy a worker service that polls your API. Each app gets its own Docker network; cross-app communication works via `host.docker.internal`.

**Apps with migrations** — define a `pre_deploy` hook that runs your migration service before the main deploy. If the migration fails, the deploy aborts.

**Multi-environment configs** — use compose overlays (`docker-compose.yml` + `docker-compose.prod.yml`) to override env vars, resource limits, or log levels per environment.

**Apps with build-time configuration** — pass `build_args` like API URLs or version strings that get baked into Docker images at build time.

## Use Cases

### Deploy and forget
```bash
jib add myapp --repo myorg/myapp --domain myapp.com
jib deploy myapp
jib serve                    # Start daemon for autodeploy on push
```

### Something broke — rollback in seconds
```bash
jib status myapp             # See the failure
jib logs myapp --tail 200    # Find the error
jib rollback myapp           # Back to previous version
```

### Secrets management
```bash
jib secrets set myapp --file .env.production
jib deploy myapp             # Secrets injected via symlink
jib env myapp                # Verify (values redacted)
```

### Multiple apps, one server
```bash
jib apps
# APP        REPO           BRANCH  STRATEGY  DOMAINS
# frontend   myorg/web      main    restart   myapp.com:8080
# api        myorg/api      main    restart   api.myapp.com:3000
# worker     myorg/worker   main    restart   worker.myapp.com:4000

jib status
# APP       SHA      STATUS   LAST DEPLOY          FAILURES  PINNED
# frontend  a1b2c3d  success  2025-03-23 10:30:00  0         false
# api       e4f5g6h  success  2025-03-23 10:31:00  0         false
# worker    i7j8k9l  success  2025-03-23 10:32:00  0         false
```

### Debug a running container
```bash
jib exec myapp api -- sh                    # Shell into running container
jib exec myapp db -- psql -U postgres       # Database console
jib run myapp api -- npx prisma migrate     # One-off migration in fresh container
jib logs myapp api -f --tail 50             # Stream logs
jib metrics myapp                           # CPU/memory/network stats
```

### SSL + reverse proxy — automatic
```bash
jib provision myapp          # Generates nginx config + obtains Let's Encrypt cert
```

### Compose overlays for production
```yaml
# config.yml
apps:
  myapp:
    compose:
      - docker-compose.yml
      - docker-compose.prod.yml    # Overrides env vars, resource limits
```

### Pre-deploy hooks (migrations)
```yaml
apps:
  myapp:
    pre_deploy:
      - service: migrations        # Runs before deploy
    services: [api, web]           # Only these stay running
```

## AI Agent Integration

Jib ships with **[SKILL.md](SKILL.md)** — a comprehensive reference designed for AI agents (Claude, etc.) to operate jib autonomously. It covers every command, config option, workflow, and troubleshooting scenario. Point your agent at this file and it can deploy, rollback, debug, and manage your infrastructure.

## Architecture

```
cmd/jib/                    CLI entrypoint (cobra)
internal/
├── config/                 YAML config parsing + validation
├── state/                  State persistence (flock + atomic writes)
├── deploy/                 Deploy + rollback orchestration
├── docker/                 Compose wrappers, health checks, override generation
├── secrets/                Secrets management + symlinks
├── proxy/                  Nginx config generation
├── ssl/                    Certbot wrapper + cert expiry
└── platform/               OS abstraction + dependency checks
```

### Deploy Flow

1. Acquire per-app file lock
2. Check disk space (abort if < 2GB)
3. Validate secrets
4. `git fetch` + `git checkout <ref>`
5. Symlink secrets, generate compose override
6. `docker compose build` (with build_args)
7. Run pre-deploy hooks
8. `docker compose up -d --force-recreate`
9. Warmup → health check (5 retries with backoff)
10. Update state, prune old images

### Docker Isolation

Every app is namespaced via `-p jib-<app>`. Two apps defining `db_data` won't clash. Jib auto-generates an override with labels, restart policy, and log rotation — your compose file is never modified.

### Filesystem

```
/opt/jib/
├── config.yml
├── state/<app>.json           # deploy state (atomic writes)
├── secrets/<app>/.env         # app secrets (0700/0600)
├── repos/<app>/               # git checkouts
├── overrides/<app>.yml        # generated compose overrides
├── nginx/<domain>.conf        # generated nginx configs
├── locks/<app>.lock           # flock files
└── deploy-keys/<app>          # SSH keys
```

## Building

```bash
make build          # produces bin/jib with embedded version
make install
```

### Dependencies

| Dep | Min Version | Why |
|-----|-------------|-----|
| Docker Engine | 24.0 | Compose V2, `--remove-orphans` |
| Docker Compose | 2.20 | `--dry-run`, consistent `run --rm` |
| Nginx | 1.18 | `conf.d/` includes, SSL directives |
| Certbot | 2.0 | Webroot mode |
| Git | 2.25 | `ls-remote` with ref filtering |
| Rclone | 1.50 | R2/S3 backups (optional) |

Ubuntu 22.04+ supported. Checked at `jib init`.

## Samples

See [`samples/`](samples/) for ready-to-deploy example apps covering common patterns:

| Sample | What it demonstrates |
|--------|---------------------|
| `fullstack/` | Frontend + API + Postgres with persistent volume |
| `worker/` | Background service polling another app's API |
| `secretapp/` | Secrets injection via `secrets_env` |
| `hookapp/` | Pre-deploy migration hooks |
| `multicompose/` | Compose overlay (base + prod) |
| `buildargapp/` | Build-time args baked into image |

## License

MIT
