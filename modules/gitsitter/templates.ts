/**
 * Systemd unit template for gitsitter. Templated so `$JIB_ROOT` and the
 * install path for the compiled binary can be threaded through without
 * hardcoding `/opt/jib` or `/usr/local/bin/jib`.
 */
export interface GitsitterTemplateVars {
  jibRoot: string
  binPath: string
}

export function systemdUnit(vars: GitsitterTemplateVars): string {
  return `[Unit]
Description=Jib gitsitter (git polling + repo ops)
After=jib-bus.service docker.service
Requires=jib-bus.service

[Service]
Type=simple
Environment=JIB_ROOT=${vars.jibRoot}
ExecStart=${vars.binPath} run gitsitter
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`
}

export const UNIT_PATH = '/etc/systemd/system/jib-gitsitter.service'
export const SERVICE_NAME = 'jib-gitsitter.service'
