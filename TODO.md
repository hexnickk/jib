# Jib — Dropped Features (re-add as modules later)

Features removed from initial modular release to keep scope minimal.
Core workflow: GitHub polling + deploy + Telegram notifications + Cloudflare tunnels.

## Notifications
- [ ] Slack notifications
- [ ] Discord notifications
- [ ] Generic webhook notifications

## Triggers
- [ ] GitHub webhook trigger (listen for push events, deploy immediately)
- [ ] Telegram bot trigger (listen for /deploy commands via bot)
- [ ] Slack bot trigger

## Ingress
- [ ] Tailscale integration (VPN mesh networking)
- [ ] Caddy support (alternative reverse proxy to nginx)

## Backup & Restore
- [ ] Backup scheduler (cron-based automatic backups)
- [ ] Backup destinations: S3, R2, SSH, local
- [ ] Backup encryption (GPG)
- [ ] Restore command
- [ ] Retention policies

## SSL / Certificates
- [ ] Certbot integration (Let's Encrypt auto-provisioning)
- [ ] Cert expiry watcher (monitor and auto-renew)

## Shared Services
- [ ] Managed databases: PostgreSQL, MySQL, MariaDB, MongoDB
- [ ] Managed caches: Redis
- [ ] Auto-generated credentials and connection strings

## Operations
- [ ] Maintenance mode (503 pages via nginx)
- [ ] Metrics command (live container resource usage)
- [ ] Cleanup command (prune Docker images/volumes)
- [ ] Self-update / upgrade command
- [ ] `jib env` commands (get/set/remove env vars via CLI)
- [ ] Cron tasks (scheduled commands in app containers)

## Deploy Engine
- [ ] Auto-generate compose from Dockerfile (if no compose file exists)
- [ ] Resource auto-detection and per-app CPU/memory limits
- [ ] Dry-run mode
- [ ] Blue-green deploy strategy (zero-downtime)
- [ ] Preview/branch deploys (PR to temporary subdomain)

## Platform
- [ ] Dependency installer (auto-install Docker, Nginx, etc.)
- [ ] Domain reachability checks (DNS classification in status)
- [ ] Custom nginx includes

## Future Integrations
- [ ] GitLab provider
- [ ] Wildcard SSL certificates (DNS challenge)
