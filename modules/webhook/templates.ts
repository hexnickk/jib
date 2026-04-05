/**
 * Systemd unit for the webhook receiver. Requires `jib-bus` so the receiver
 * can publish `cmd.repo.prepare` / `cmd.deploy` as soon as GitHub pushes
 * arrive. `$JIB_ROOT` is templated at install time so non-default roots work.
 */
export interface WebhookTemplateVars {
  jibRoot: string
  binPath: string
}

export function systemdUnit(vars: WebhookTemplateVars): string {
  return `[Unit]
Description=Jib webhook receiver
After=jib-bus.service
Requires=jib-bus.service

[Service]
Type=simple
Environment=JIB_ROOT=${vars.jibRoot}
ExecStart=${vars.binPath} service start webhook
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`
}

export const UNIT_PATH = '/etc/systemd/system/jib-webhook.service'
export const SERVICE_NAME = 'jib-webhook.service'
