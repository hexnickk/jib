# Jib Service Architecture Spec

Refactor from monolithic daemon to NATS-based microservice architecture.

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  webhook    │  │  slack bot  │  │  telegram   │  (trigger/notifier containers)
│  trigger    │  │  trigger    │  │  notifier   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       └────────────────┼────────────────┘
                        │ nats://jib-bus:4222
                   ┌────┴────┐
                   │  NATS   │  (container, nats:alpine, token auth)
                   └────┬────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ┌────┴────┐   ┌─────┴─────┐  ┌────┴─────┐
    │   jib   │   │  health   │  │  certs   │
    │  daemon │   │  monitor  │  │  watcher │
    │ (host)  │   │(container)│  │(container)│
    └─────────┘   └───────────┘  └──────────┘
```

### Host services (stay on host)
- **jib CLI** — the management tool, bootstraps everything
- **jib daemon** — command executor, poller, backup scheduler
- **nginx** — reverse proxy, binds 80/443, reads certs from /etc/letsencrypt

### Docker containers (jib service stack at /opt/jib/stack/docker-compose.yml)
- **NATS** — message bus (`nats:alpine`, port 4222 exposed to host, token auth)
- **webhook trigger** — receives GitHub/GitLab pushes, publishes deploy commands
- **health monitor** — HTTP health checks, publishes health events
- **cert watcher** — monitors cert expiry, publishes cert events + renew commands
- **notifiers** — one per channel (telegram, slack, discord, webhook)
- **cloudflared** — Cloudflare tunnel (`cloudflare/cloudflared`, `network_mode: host`)
- **tailscale** — VPN mesh (`tailscale/tailscale`, `network_mode: host`, NET_ADMIN + /dev/net/tun)
- **certbot** — SSL cert obtainer/renewer (`certbot/certbot`, mounts /etc/letsencrypt)

### What stays in the daemon and why
- **Git poller** — needs same repos, locks, and git state as deploy engine. Extracting creates distributed coordination problem for ~60 lines of code.
- **Backup scheduler** — needs Docker socket and host filesystem for volume backups.
- **Deploy engine** — needs Docker socket, git repos, nginx configs, certbot.

## Message Protocol

### Base envelope
```go
type Message struct {
    ID            string    `json:"id"`             // UUID
    Version       int       `json:"version"`        // always 1 for now
    CorrelationID string    `json:"correlation_id,omitempty"` // ties command → events
    Timestamp     time.Time `json:"timestamp"`
    Source        string    `json:"source"`         // "webhook", "poller", "cli", "health", "certs"
}
```

### Commands (trigger → daemon)

Commands are async fire-and-forget. The daemon publishes a result event when done.
The trigger gets an immediate ACK via NATS request-reply ("command accepted"),
NOT the final result (deploys take minutes).

```go
// jib.command.deploy.<app>
type DeployCommand struct {
    Message
    App     string `json:"app"`
    Ref     string `json:"ref,omitempty"`     // git ref, empty = latest
    Trigger string `json:"trigger"`           // "webhook", "autodeploy", "manual"
    User    string `json:"user"`
    Force   bool   `json:"force,omitempty"`
    DryRun  bool   `json:"dry_run,omitempty"`
}

// jib.command.rollback.<app>
type RollbackCommand struct {
    Message
    App  string `json:"app"`
    User string `json:"user"`
}

// jib.command.backup.<app>
type BackupCommand struct {
    Message
    App  string `json:"app"`
    User string `json:"user"`
}

// jib.command.maintenance.<app>
type MaintenanceCommand struct {
    Message
    App     string `json:"app"`
    Enabled bool   `json:"enabled"` // true = on, false = off
    User    string `json:"user"`
}

// jib.command.cert.renew.<domain>
type CertRenewCommand struct {
    Message
    Domain string `json:"domain"`
}

// jib.command.config.reload
type ConfigReloadCommand struct {
    Message
}
```

### Command ACK (immediate reply via NATS request-reply)
```go
type CommandAck struct {
    Accepted      bool   `json:"accepted"`
    CorrelationID string `json:"correlation_id"` // ties back to command
    Error         string `json:"error,omitempty"` // e.g. "deploy already in progress"
}
```

### Events (daemon/monitors → notifiers)

Events are fire-and-forget pub/sub. Notifiers subscribe and decide independently
which events to forward based on their own config.

```go
// jib.event.deploy.<app>.success / .failure
type DeployEvent struct {
    Message
    App         string `json:"app"`
    SHA         string `json:"sha"`
    PreviousSHA string `json:"previous_sha,omitempty"`
    Strategy    string `json:"strategy"`
    Status      string `json:"status"`      // "success" or "failure"
    Trigger     string `json:"trigger"`
    User        string `json:"user"`
    Error       string `json:"error,omitempty"`
    DurationMs  int64  `json:"duration_ms"`
}

// jib.event.health.<app>.failed / .recovered
type HealthEvent struct {
    Message
    App      string `json:"app"`
    Endpoint string `json:"endpoint"`
    Status   string `json:"status"` // "failed" or "recovered"
    Error    string `json:"error,omitempty"`
}

// jib.event.cert.<domain>.expiring
type CertEvent struct {
    Message
    Domain   string `json:"domain"`
    DaysLeft int    `json:"days_left"`
    Error    string `json:"error,omitempty"`
}

// jib.event.backup.<app>.success / .failure
type BackupEvent struct {
    Message
    App        string `json:"app"`
    Status     string `json:"status"` // "success" or "failure"
    Error      string `json:"error,omitempty"`
    DurationMs int64  `json:"duration_ms"`
}

// jib.heartbeat.daemon (periodic, every 30s)
type Heartbeat struct {
    Message
    Apps    []string `json:"apps"`    // list of managed apps
    Uptime  int64    `json:"uptime_s"`
}
```

### Topic scheme
```
jib.command.deploy.<app>
jib.command.rollback.<app>
jib.command.backup.<app>
jib.command.maintenance.<app>
jib.command.cert.renew.<domain>
jib.command.config.reload

jib.event.deploy.<app>.success
jib.event.deploy.<app>.failure
jib.event.health.<app>.failed
jib.event.health.<app>.recovered
jib.event.cert.<domain>.expiring
jib.event.backup.<app>.success
jib.event.backup.<app>.failure

jib.heartbeat.daemon
```

### Deploy deduplication
When the daemon receives a deploy command for an app that is already deploying,
it immediately replies with `CommandAck{Accepted: false, Error: "deploy already in progress"}`
instead of blocking on the file lock.

### Notification routing
Events do NOT carry channel routing info. Each notifier container reads
the jib config (bind-mounted) and independently decides which apps/event types
to forward based on the app's `notify` field.

### Security
NATS uses token auth. Separate tokens for:
- `jib-daemon` — subscribe to commands, publish events
- `jib-trigger` — publish commands only
- `jib-monitor` — publish events only
- `jib-notifier` — subscribe to events only

## Implementation Stages

### Stage 1: Bus library + NATS in service stack [DONE]
- [x] Create `internal/bus/` package (connect, publish, subscribe, typed messages)
- [x] Create `internal/bus/topics.go` (topic constants)
- [x] Create `internal/bus/messages.go` (all message/command/event types)
- [x] Create `internal/stack/` package (generate + manage stack compose)
- [x] Stack compose with NATS + token auth
- [x] Add `github.com/nats-io/nats.go` dependency
- [x] No behavior changes — everything still works as before

### Stage 2: Daemon publishes events to NATS [DONE]
- [x] Daemon connects to NATS on startup (optional, works without)
- [x] Publish deploy events after engine.Deploy()
- [x] Publish health events from health monitor
- [x] Publish cert events from cert watcher
- [x] Publish backup events from scheduler
- [x] Publish heartbeat every 30s
- [x] Purely additive — existing notification still works alongside

### Stage 3: Daemon subscribes to commands + dedup [DONE]
- [x] Subscribe to `jib.command.deploy.>`, `jib.command.rollback.>`, etc.
- [x] Command handler decodes message, calls deploy/rollback engine
- [x] Deploy dedup: reject if app is already deploying (check file lock non-blocking)
- [x] Publish result events after execution
- [x] Immediate ACK via request-reply

### Stage 4: Extract webhook into container [DONE]
- [x] New `cmd/jib-webhook/` — standalone HTTP server
- [x] Validates signatures, publishes DeployCommand to NATS
- [x] Returns 202 to caller immediately (or 409 if rejected)
- [x] Delete `internal/daemon/webhook.go`
- [ ] Add webhook container to stack compose (deferred to Stage 7)
- [ ] Dockerfile (deferred to Stage 7)

### Stage 5: Extract health monitor + cert watcher into containers [DONE]
- [x] New `cmd/jib-health/` — HTTP health checks with state tracking (transitions only)
- [x] New `cmd/jib-certs/` — cert expiry monitor, publishes events + renew commands
- [x] Delete `internal/daemon/health.go` and `internal/daemon/certs.go`
- [x] Daemon now: poller + backup scheduler + NATS command handler + heartbeat
- [x] Removed dead `publishHealthEvent` from daemon

### Stage 6: Extract notifiers into containers [DONE]
- [x] New `cmd/jib-notify/` — subscribes to all events, routes to channels
- [x] Reads config for per-app channel routing (app.notify field)
- [x] Reuses existing notify package drivers (telegram, slack, discord, webhook)
- [x] Removed direct notifyBackup calls from daemon scheduler
- [x] Remove notifier from deploy engine

### Stage 7: Update CLI — init, status, stack management [DONE]
- [x] `jib init` generates stack compose, creates NATS tokens, starts stack
- [x] `jib status` shows Services section (docker compose ps for stack)
- [x] Tokens persisted at /opt/jib/stack/tokens.json for idempotent re-runs
- [x] cloudflared → stack container (reads token from mounted secret)
- [x] tailscale → stack container (reads auth key from mounted secret)
- [ ] certbot → stack container (future — currently runs on host via daemon command handler)

## Design decisions

- **Poller stays in daemon** — tightly coupled to repos/locks/git state
- **Backup scheduler stays in daemon** — needs Docker socket + host filesystem
- **NATS runs in Docker** — if it dies, CLI still works directly; NATS is only for async services
- **No JetStream/persistence** — lost messages during restart caught by poller on next cycle
- **Config via bind mounts** — config changes trigger `docker compose up -d`
- **notify.Event remains canonical** — NATS event types align with it, notifier container reuses existing driver code
