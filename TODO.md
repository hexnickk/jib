# TODOs

- [ ] Introduce jib-stack.service as a systemd oneshot unit that manages the Docker Compose stack (jib-bus + module containers). Wire the native services (jib-deployer, jib-watcher) to depend on it explicitly, replacing the implicit nc -z 4222 busy-wait.
- [ ] Bring back history

## Statuses

- [ ] Bring back health checker

## Triggers
- [ ] GitHub webhook trigger (listen for push events, deploy immediately)

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
