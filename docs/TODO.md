# V0

- [ ] add SKILLS.md
- [ ] `jib watch` should be removed from a list of commands
- [ ] looks like user aren't added to a docker group during installation
- [ ] jib remove didn't work
  ```
  hexnickk@hexrunner:~$ jib remove chaindynamicsltd-landing
  │
  ◇  Remove app "chaindynamicsltd-landing" (chaindynamics.co.uk)?
  │  Yes
  │
  ◇  ingress released
  time="2026-04-28T11:52:07Z" level=warning msg="/opt/jib/repos/github/chaindynamicsltd/landing/docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion"
  Container jib-chaindynamicsltd-landing-web-1  Stopping
  Container jib-chaindynamicsltd-landing-web-1  Stopped
  Container jib-chaindynamicsltd-landing-web-1  Removing
  Container jib-chaindynamicsltd-landing-web-1  Removed
  Network jib-chaindynamicsltd-landing_default  Removing
  Network jib-chaindynamicsltd-landing_default  Removed

  [11:52:07 AM]  WARN  repo cleanup: EACCES: permission denied, rm '/opt/jib/repos/github/chaindynamicsltd/landing'

  ✔ removed chaindynamicsltd-landing                                              11:52:07 AM
  hexnickk@hexrunner:~$ ls -l /opt/jib/
  total 36
  drwxrws--- 2 root     jib 4096 Apr 10 16:48 cloudflared
  -rw-r----- 1 hexnickk jib  575 Apr 28 11:52 config.yml
  drwxrws--- 2 root     jib 4096 Apr 11 20:27 locks
  drwxrws--- 3 root     jib 4096 Apr 28 11:52 nginx
  drwxrws--- 2 root     jib 4096 Apr 28 11:52 overrides
  drwxrws--- 3 root     jib 4096 Apr 10 18:18 repos
  drwxrws--- 3 root     jib 4096 Apr 10 16:49 secrets
  drwxrws--- 2 root     jib 4096 Apr 10 16:45 src
  drwxrws--- 2 root     jib 4096 Apr 28 11:52 state
  hexnickk@hexrunner:~$ ls -l /opt/jib/repos/
  total 4
  drwxrwsr-x 4 hexnickk jib 4096 Apr 11 20:23 github
  hexnickk@hexrunner:~$ ls -l /opt/jib/repos/github/
  total 8
  drwxrwsr-x 3 hexnickk jib 4096 Apr 11 20:32 chaindynamicsltd
  drwxrwsr-x 3 hexnickk jib 4096 Apr 11 20:06 hexnickk
  hexnickk@hexrunner:~$ ls -l /opt/jib/repos/github/chaindynamicsltd/
  total 4
  drwxr-sr-x 6 root jib 4096 Apr 11 20:32 landing
  hexnickk@hexrunner:~$ rm '/opt/jib/repos/github/chaindynamicsltd/landing'
  rm: cannot remove '/opt/jib/repos/github/chaindynamicsltd/landing': Is a directory
  hexnickk@hexrunner:~$ rm -rf '/opt/jib/repos/github/chaindynamicsltd/landing'
  rm: cannot remove '/opt/jib/repos/github/chaindynamicsltd/landing/vite.config.js': Permission denied
  rm: cannot remove '/opt/jib/repos/github/chaindynamicsltd/landing/.gitignore': Permission denied
  ...
  ```
- [ ] `jib logs` doesn't exists
- [ ] move away from bun

# 28 April

- [x] `jib` should show help if no commands
- [x] env variables should be optional
  ```
  ▲  Value for TELEGRAM_BOT_TOKEN
  │  secret-or-value
  └  value required
  ```

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
