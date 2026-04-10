/**
 * Systemd unit template for the watcher. Templated so `$JIB_ROOT` and the
 * install path for the jib binary can be threaded through without
 * hardcoding `/opt/jib` or `/usr/local/bin/jib`.
 */
export interface WatcherUnitVars {
  jibRoot: string
  binPath: string
}

export function systemdUnit(vars: WatcherUnitVars): string {
  return `[Unit]
Description=Jib watcher (git polling + autodeploy)
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
Environment=JIB_ROOT=${vars.jibRoot}
ExecStart=${vars.binPath} watch
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`
}

export const UNIT_PATH = '/etc/systemd/system/jib-watcher.service'
export const SERVICE_NAME = 'jib-watcher.service'
