# V0

- [ ] add documentation
- [ ] consider if any other linters can be added
- [ ] there must be no external dependencies with "*" as a version (see nats & yaml)
- [ ] introduce jib-stack.service as a systemd oneshot unit that manages the Docker Compose stack (jib-bus + module containers). Wire the native services (jib-deployer, jib-watcher) to depend on it explicitly, replacing the implicit nc -z 4222 busy-wait.
- [ ] `jib env` commands (get/set/remove env vars via CLI)

# V1

- [ ] Consider not running cloudflare daemon as it is only needed when adding a new domain
- [ ] Bring back history
- [ ] Bring back health checker
- [ ] Self-update / upgrade command
- [ ] Auto-generate compose from Dockerfile (if no compose file exists)
- [ ] Certbot integration (Let's Encrypt auto-provisioning)
- [ ] Cert expiry watcher (monitor and auto-renew)
- [ ] Metrics command (live container resource usage)
- [ ] Cleanup command (prune Docker images/volumes)

# Backlog

- [ ] GitHub webhook trigger (listen for push events, deploy immediately)
- [ ] Tailscale integration (VPN mesh networking)
- [ ] Caddy support (alternative reverse proxy to nginx)
- [ ] Backup scheduler (cron-based automatic backups)
- [ ] Backup destinations: S3, R2, SSH, local
- [ ] Backup encryption (GPG)
- [ ] backup-restore command
- [ ] Retention policies
- [ ] Managed databases: PostgreSQL, MySQL, MariaDB, MongoDB
- [ ] Managed caches: Redis
- [ ] Maintenance mode (503 pages via nginx)
- [ ] Cron tasks (scheduled commands in app containers)
- [ ] Resource auto-detection and per-app CPU/memory limits
- [ ] Blue-green deploy strategy (zero-downtime)
- [ ] Preview/branch deploys (PR to temporary subdomain)
- [ ] Domain reachability checks (DNS classification in status)
- [ ] Custom nginx includes
- [ ] GitLab provider
- [ ] Wildcard SSL certificates (DNS challenge)
