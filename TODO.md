# V0

- add documentation

# 25 April

- [x] Suggest how to reload groups during initial installation
- [x] There should be a suggestion how to get this token
  ◇  Enable optional module "cloudflared"? Cloudflare Tunnel daemon (optional)
  │  Yes
  │
  ◆  cloudflared
  │
  ◆  Tunnel token (or full "cloudflared service install <token>" command)
  │  _
  └
- [x] jib-watcher & jib-cloudflared are disabled at the start

# 11 April

- [x] split cloudflared modules into app/cli/module
- [x] rename apps/cli -> src
- [x] merge modules/core with apps/cli/modules/runtime

# 10 April

- [x] remove @main.ts & move apps/jib/main.ts to apps/cli/main.ts
- [x] remove getModuleSubCommands from main.ts
- [x] move src/commands to apps/cli/ (so they resemble file-based routing structure in next.js)
- [x] clean up src folder (either modules, either libs)
- [x] remove githubcmd from cli as it's a part of sources cmd
- [ ] ~~cloudflared service should live in apps~~
- [ ] ~~consider not running cloudflare daemon as it is only needed when adding a new domain~~
- [ ] ~~split cloudflared modules into app/cli/module~~

# V1

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
- [ ] Extract a GitProvider interface now — the watcher depends on an abstract interface (cloneURL, refreshAuth, applyAuth), github implements it. When GitLab arrives, it just implements the same interface. ~150 LoC of refactoring.
- [ ] split between runtime env & build env
- [ ] runtime secrets & build variables are stored separately, which is a bug
