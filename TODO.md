# Jib — Implementation Roadmap

Ordered for sequential implementation. Each task builds on previous ones where noted.

---

## Phase 1: Fix What's Broken

### 1. Fix exit codes
All commands must return non-zero on failure. Currently some `RunE` functions swallow errors or return nil after printing an error message.

**What to do:**
- Audit every `RunE` handler in `cmd/jib/*.go`
- Ensure errors from internal packages propagate up through `RunE` return values
- The `main.go` already prints errors and calls `os.Exit(1)` — just need the errors to reach it
- Test: `jib deploy nonexistent; echo $?` should print `1`
- Test: `jib rollback <app-with-no-previous>`; echo $?` should print `1`

**Files:** `cmd/jib/deploy.go`, `cmd/jib/observe.go`, `cmd/jib/operate.go`, `cmd/jib/config.go`

---

### 2. Fix `jib config set` type handling
`jib config set` stores all values as YAML strings, corrupting booleans (`secrets_env: "true"` instead of `secrets_env: true`) and numbers.

**What to do:**
- Before inserting the value into the config map, parse it as YAML first: `yaml.Unmarshal([]byte(value), &parsed)`
- `"true"` → `bool(true)`, `"123"` → `int(123)`, `"hello"` → `string("hello")`
- If the value is a complex structure (map/list), reject with an error pointing to `jib edit`
- Test: `jib config set apps.myapp.secrets_env true` → should write a YAML boolean
- Test: `jib config set certbot_email foo@bar.com` → should write a string

**Files:** `cmd/jib/config.go` (the `runConfigSet` function)

---

## Phase 2: Small Features

### 3. `jib remove <app>`
Fully remove an app from the server. Currently a stub.

**What to do:**
- If `--force` not set, print what will be removed and ask for confirmation (read stdin for "y")
- Run `docker compose down -v` (optional `--volumes` flag to also remove volumes, default: keep volumes)
- Remove nginx configs via `proxy.RemoveConfigs()`
- Remove state file: `/opt/jib/state/<app>.json`
- Remove domain state: `/opt/jib/state/<app>.domains.json`
- Remove secrets: `/opt/jib/secrets/<app>/`
- Remove repo: `/opt/jib/repos/<app>/`
- Remove override: `/opt/jib/overrides/<app>.yml`
- Remove app from `config.yml` (load raw YAML, delete key from `apps` map, write back)
- Reload nginx
- Print summary of what was removed

**Flags:**
- `--force` — skip confirmation
- `--volumes` — also remove Docker volumes (default: preserve data)

**Files:** `cmd/jib/setup.go` (replace the stub `RunE`)

---

### 4. `jib env set/del`
Manage individual environment variables without rewriting the whole `.env` file.

**What to do:**
- `jib env set <app> KEY=VALUE` — read `/opt/jib/secrets/<app>/.env`, update or append the line, write back
- `jib env set <app> KEY=VALUE KEY2=VALUE2` — multiple in one call
- `jib env del <app> KEY` — remove a line from the `.env` file
- If the secrets file doesn't exist yet, create it (with proper 0700/0600 permissions)
- If `secrets_env` is not true in config, print a warning: "Note: enable secrets_env in config for this app to use these vars"
- After modification, print: "Restart or redeploy to apply changes."

**Files:** `cmd/jib/observe.go` (where `env` command is registered), `internal/secrets/secrets.go` (add `SetVar`, `DelVar` methods)

---

### 5. `jib history`
Append-only event log per app. Foundation for deploy timeline, audit trail, and future notifications.

**What to do:**
- Create `internal/history/history.go`:
  - `Append(app string, event Event)` — append a JSON line to `/opt/jib/logs/<app>.jsonl`
  - `Read(app string, limit int) []Event` — read last N events
  - Event struct: `{timestamp, type, sha, previous_sha, trigger, user, status, error, duration_ms}`
  - Event types: `deploy`, `rollback`, `backup`, `restore`, `config_change`
- Wire into deploy engine: after deploy/rollback completes, call `history.Append()`
- Implement the `jib history <app>` command:
  - Default: last 20 events, human-readable table
  - `--limit N` — show N events
  - `--json` — raw JSON lines
- Create `/opt/jib/logs/` directory in init/first-use

**Files:** new `internal/history/history.go`, `internal/deploy/deploy.go`, `internal/deploy/rollback.go`, `cmd/jib/observe.go`

---

### 6. Maintenance mode
Swap nginx to serve a 503 page while keeping containers running.

**What to do:**
- `jib maintenance on <app>` — for each domain of the app, replace the nginx config with a 503 server block. Save the original config to `<domain>.conf.bak`.
- `jib maintenance off <app>` — restore from `.bak`, reload nginx.
- `jib maintenance status` — show which apps are in maintenance.
- The 503 page should be a simple built-in HTML template: "Service is temporarily unavailable. We'll be back shortly."
- Optional: `--message "Deploying new version, back in 5 minutes"` custom message.
- `jib status` should show `maintenance` in the status column when active.
- `jib deploy` should warn if app is in maintenance mode (but not block).

**Files:** `internal/proxy/nginx.go` (add `MaintenanceOn`, `MaintenanceOff`), new `cmd/jib/operate.go` subcommand, `internal/proxy/templates.go` (503 template)

---

### 7. Resource limits with smart defaults
Per-app CPU/memory limits, auto-suggested based on server resources.

**What to do:**
- Add to config schema:
  ```yaml
  apps:
    myapp:
      resources:
        memory: 256M
        cpus: "0.5"
  ```
- When `jib add` runs, detect total server RAM and CPU, subtract overhead (~500MB RAM, 0.5 CPU for OS/Docker), divide remaining by (current app count + 1), suggest defaults.
- Write resource limits into the generated override file (`/opt/jib/overrides/<app>.yml`):
  ```yaml
  services:
    api:
      deploy:
        resources:
          limits:
            memory: 256M
            cpus: "0.5"
  ```
- `jib doctor` should warn if total allocated resources exceed server capacity.
- If not set in config, apply sensible defaults (don't leave apps unlimited).

**Files:** `internal/config/config.go` (add `Resources` struct to `App`), `internal/docker/override.go` (include limits), `cmd/jib/setup.go` (suggest in `runAdd`), `internal/platform/` (add `ServerResources()` function)

---

### 8. `jib upgrade`
Self-update the jib binary from GitHub Releases.

**What to do:**
- Fetch latest release tag from `https://api.github.com/repos/hexnickk/jib/releases/latest`
- Compare with current `version` variable — if same, print "Already up to date" and exit
- Download binary for current OS/arch to a temp file
- Verify it's executable (run `<tmp>/jib version`)
- Replace current binary (`/usr/local/bin/jib` or wherever `os.Executable()` points)
- Print "Upgraded jib from vX.Y.Z to vA.B.C"
- Handle permissions: if current binary needs sudo to replace, prompt or fail with clear message

**Files:** `cmd/jib/operate.go` (replace stub), reuse logic from `install.sh`

---

## Phase 3: Infrastructure Features

### 9. `jib init` — interactive onboarding
Full server bootstrap. This is the first thing every new user runs.

**What to do:**
- Check if already initialized (`/opt/jib/config.yml` exists) — if so, offer to re-run or abort
- **Always install** (no choice): Docker, Docker Compose, nginx, git
  - Detect OS (Ubuntu 22.04+ only for now)
  - `apt-get update && apt-get install -y docker.io docker-compose-v2 nginx git`
  - Enable and start services: `systemctl enable --now docker nginx`
- **Domain/SSL choice** (pick one):
  - Certbot (default) — `apt-get install -y certbot python3-certbot-nginx`, ask for email
  - Cloudflare Tunnel — install `cloudflared`, run auth flow
  - Tailscale — install tailscale, run auth flow
  - None — skip, user manages SSL externally
- **Optional: backups** — install rclone, walk through destination setup (R2/S3/SSH), test connection, write to config
- **Optional: notifications** — walk through Telegram/Slack/Discord setup, test send, write to config
- Create directory structure: `/opt/jib/{state,secrets,repos,overrides,nginx,backups,locks,deploy-keys,logs}`
- Generate initial `config.yml` with chosen options
- Install and start systemd service for jib daemon
- Run `jib doctor` at the end to verify everything
- Offer to `jib add` first app

**Flags:**
- `--non-interactive` — use all defaults, skip prompts (for scripting)
- `--skip-install` — assume deps are already installed, just create config/dirs

**Files:** `cmd/jib/setup.go` (replace stub), new `internal/platform/install.go` (package installation), systemd unit template

**Depends on:** daemon implementation (#14)

---

### 10. Notifications — named instances, per-app routing
Multi-channel notifications with named instances.

**What to do:**
- Refactor config schema:
  ```yaml
  notifications:
    ops-telegram:
      driver: telegram
    dev-slack:
      driver: slack
    alerts:
      driver: webhook

  apps:
    myapp:
      notify: [ops-telegram]
    critical-api:
      notify: [ops-telegram, dev-slack, alerts]
  ```
- CLI commands:
  - `jib telegram add <name>` — prompt for bot token + chat ID, store in `/opt/jib/secrets/_jib/<name>.json`, write to config
  - `jib telegram test <name>` — send test message
  - `jib slack add <name>` — prompt for webhook URL
  - `jib slack test <name>`
  - `jib discord add <name>` — prompt for webhook URL
  - `jib discord test <name>`
  - `jib notify add <name> --driver webhook --url <url>` — generic webhook
  - `jib notify list` — show all configured channels with driver and which apps use them
  - `jib notify remove <name>` — remove channel from config and delete credentials
  - `jib notify test <name>` — send test to specific channel
- Refactor `internal/notify/` to load channels by name from config + secrets
- The deploy engine and daemon use app's `notify` list to determine where to send
- Events: deploy success/failure, rollback, backup success/failure, health check failure, cert expiry warning

**Files:** `internal/notify/` (refactor), `internal/config/config.go` (schema change), new `cmd/jib/notify.go`, `cmd/jib/config.go` (remove old notify stubs)

---

### 11. `jib github setup <app>`
Set up GitHub integration for an app — deploy key and webhook.

**What to do:**
- Generate an SSH deploy key: `ssh-keygen -t ed25519 -f /opt/jib/deploy-keys/<app> -N ""`
- Print the public key and instruct user to add it to GitHub repo → Settings → Deploy Keys
- Ask for (or auto-detect from `repo` config) the GitHub repo
- Generate a random webhook secret, store at `/opt/jib/secrets/_jib/<app>-webhook.json`
- Print the webhook URL: `http://<server-ip>:9090/_jib/webhook/<app>`
- Instruct user to add it to GitHub repo → Settings → Webhooks
- Set content type to `application/json`, events: `push`
- Optionally, if `gh` CLI is available and authenticated, do it automatically via API
- Store webhook config in app config:
  ```yaml
  apps:
    myapp:
      webhook:
        provider: github
        # secret stored in secrets dir
  ```

**Files:** new `cmd/jib/github.go`, `internal/config/config.go` (webhook config struct)

**Depends on:** daemon (#14) for receiving webhooks

---

### 12. Tunnel setup — Cloudflare and Tailscale
Platform-specific tunnel commands.

**What to do:**
- `jib cloudflare setup`:
  - Install `cloudflared` if missing
  - Run `cloudflared tunnel login` (interactive browser auth)
  - Create tunnel: `cloudflared tunnel create jib`
  - Store credentials
  - Print instructions for DNS setup
- `jib cloudflare add <domain>`:
  - Add DNS route: `cloudflared tunnel route dns jib <domain>`
  - Configure tunnel to route to local nginx
- `jib cloudflare status` — show tunnel status
- `jib tailscale setup`:
  - Install tailscale if missing
  - Run `tailscale up` (interactive auth)
  - Enable HTTPS: `tailscale cert <domain>` for Tailscale-managed certs
- `jib tailscale status` — connection status

**Files:** new `cmd/jib/cloudflare.go`, new `cmd/jib/tailscale.go`

---

### 13. Shared services
Standalone databases/Redis/etc shared across apps.

**What to do:**
- `jib service add <type> --name <name> [--version X]`:
  - Supported types: `postgres`, `mysql`, `redis`, `mongodb`, `mariadb`
  - Creates a standalone docker-compose.yml at `/opt/jib/services/<name>/docker-compose.yml`
  - Starts the service on the `jib-shared` network
  - Manages volume: `jib-service-<name>_data`
  - Generates credentials, stores in `/opt/jib/secrets/_services/<name>.env`
  - Prints connection string: `postgres://jib:generated-pass@<name>:5432/<name>`
- `jib service list` — show all shared services with status
- `jib service remove <name> [--volumes]` — stop and remove
- `jib service status <name>` — health, uptime, resource usage
- Create `jib-shared` Docker network on first use (or in init)
- Apps reference it:
  ```yaml
  # In app's docker-compose.yml
  networks:
    jib-shared:
      external: true
  ```
- Backup integration: shared services should appear in `jib backup` targets
- `jib doctor` checks health of shared services

**Files:** new `internal/service/service.go`, new `cmd/jib/service.go`, `internal/config/config.go` (services config section)

---

### 14. Backup and restore
Full backup system with scheduling, multiple destinations, per-app routing.

**What to do:**
- Config schema:
  ```yaml
  backup_destinations:
    hot:
      driver: r2
      bucket: my-backups
      retain: 7
    offsite:
      driver: ssh
      host: backup.example.com
      path: /backups
      retain: 30

  apps:
    myapp:
      backup:
        destinations: [hot, offsite]
        schedule: "0 4 * * *"
        volumes: [db_data]
  ```
- `jib backup <app>`:
  - Stop writes if possible (optional pre-backup hook)
  - For each volume: `docker run --rm -v <volume>:/data -v /tmp:/backup alpine tar czf /backup/<app>-<volume>-<timestamp>.tar.gz /data`
  - Upload to each configured destination
  - Apply retention policy (delete old backups beyond retain count)
  - Log event to history
- `jib backup list <app>` — show available backups across all destinations with timestamps and sizes
- `jib restore <app> --from <timestamp>`:
  - Download backup from destination
  - Stop app containers
  - Restore volume data
  - Start app containers
  - `--dry-run` — download and verify without restoring
  - `--force` — skip confirmation
- `jib backup-dest add <name> --driver <r2|s3|ssh|local>` — interactive setup, test connection
- `jib backup-dest list` — show destinations with last-used, health
- `jib backup-dest remove <name>`
- `jib backup-dest test <name>` — write+read+delete a test file
- Scheduled backups run via the daemon (#15)
- SSH destination uses `rsync` or `scp`

**Files:** new `internal/backup/backup.go`, new `internal/backup/destinations.go`, new `cmd/jib/backup.go`, `internal/config/config.go` (schema updates)

**Depends on:** daemon (#15) for scheduled backups

---

### 15. Daemon (internal service)
The always-running jib process. Not a user-facing command — installed as a systemd service by `jib init`.

**What to do:**
- Main loop with concurrent goroutines:
  - **Git poller**: every `poll_interval` (default 5m), check each app's remote for new commits. If new commit found and app not pinned and consecutive_failures < 3, trigger deploy.
  - **Webhook server**: HTTP server on configured port (default 9090). Receives GitHub/GitLab push payloads, validates signature, triggers deploy for matching app.
  - **Backup scheduler**: parse each app's `backup.schedule` cron expression, run backups at the right time.
  - **Health monitor**: every 60s, check health endpoints for all running apps. If unhealthy, increment failure count and notify. If container crashed, notify.
  - **Cert watcher**: daily check cert expiry for all domains. Warn at 14 days, attempt renewal at 7 days.
- Signal handling: SIGHUP reloads config, SIGTERM graceful shutdown
- PID file at `/opt/jib/jib.pid`
- Logging to `/opt/jib/logs/daemon.log` (rotate at 10MB)
- Systemd unit file:
  ```ini
  [Unit]
  Description=Jib Deploy Daemon
  After=docker.service nginx.service

  [Service]
  ExecStart=/usr/local/bin/jib _daemon
  Restart=always
  RestartSec=5

  [Install]
  WantedBy=multi-user.target
  ```
- Internal command `jib _daemon` (underscore = hidden from help) starts the daemon
- `jib doctor` checks if daemon is running

**Files:** new `internal/daemon/daemon.go`, `internal/daemon/poller.go`, `internal/daemon/webhook.go`, `internal/daemon/scheduler.go`, `internal/daemon/health.go`, `cmd/jib/daemon.go` (replace stub)

---

## Implementation Order

```
Phase 1 — Fix What's Broken (do first, small)
  1. Fix exit codes
  2. Fix jib config set types

Phase 2 — Small Features (high value, low effort)
  3. jib remove
  4. jib env set/del
  5. jib history + log persistence
  6. Maintenance mode
  7. Resource limits
  8. jib upgrade

Phase 3 — Infrastructure (larger, build in order)
  9.  jib init (depends on #15 for systemd setup, but can stub that part)
  10. Notifications (named instances, per-app routing)
  11. jib github setup
  12. Tunnel setup (Cloudflare, Tailscale)
  13. Shared services
  14. Backup and restore
  15. Daemon
```

Note: #9 (init) and #15 (daemon) are circular — init installs the daemon, daemon is part of init. Implement init first with a TODO for the systemd part, then implement daemon, then wire the systemd install into init.
