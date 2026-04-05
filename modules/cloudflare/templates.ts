/**
 * Systemd unit template for the long-running cloudflare operator. Mirrors the
 * nginx/deployer units: `Requires=jib-bus.service` so the NATS bus is up
 * before the operator tries to connect, and `$JIB_ROOT` is propagated via an
 * explicit `Environment=` line rather than hard-coded.
 */

export interface SystemdUnitVars {
  jibRoot: string
  binPath: string
}

export function renderSystemdUnit(vars: SystemdUnitVars): string {
  return `[Unit]
Description=jib cloudflare operator
Requires=jib-bus.service
After=jib-bus.service

[Service]
Type=simple
Environment=JIB_ROOT=${vars.jibRoot}
ExecStart=${vars.binPath} service start cloudflare
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`
}

export const CLOUDFLARE_UNIT_PATH = '/etc/systemd/system/jib-cloudflare.service'
export const CLOUDFLARE_SERVICE_NAME = 'jib-cloudflare.service'
