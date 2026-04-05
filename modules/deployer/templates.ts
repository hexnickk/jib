/**
 * Systemd unit template for the deployer service. Only requires `jib-bus`,
 * NOT gitsitter — the deployer should start cleanly on hosts where gitsitter
 * is down so a human can still trigger a manual deploy over NATS.
 */
export interface DeployerTemplateVars {
  jibRoot: string
  binPath: string
}

export function systemdUnit(vars: DeployerTemplateVars): string {
  return `[Unit]
Description=Jib deployer
After=jib-bus.service docker.service
Requires=jib-bus.service

[Service]
Type=simple
Environment=JIB_ROOT=${vars.jibRoot}
ExecStart=${vars.binPath} service start deployer
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`
}

export const UNIT_PATH = '/etc/systemd/system/jib-deployer.service'
export const SERVICE_NAME = 'jib-deployer.service'
