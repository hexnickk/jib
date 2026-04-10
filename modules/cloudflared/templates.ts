/**
 * Inlined templates for the cloudflared systemd unit + docker-compose.
 * Token lives in a secrets env file referenced via `env_file:` — passing
 * the secret as an environment variable, never as a volume mount.
 */

export interface CloudflaredTemplateVars {
  cloudflaredDir: string
  tunnelEnvPath: string
}

export function composeYaml(vars: CloudflaredTemplateVars): string {
  return `# Managed by jib (modules/cloudflared) — do not edit.
# The tunnel token is passed as an environment variable via env_file (never
# as a volume mount). \`jib cloudflared setup\` writes the env file.
name: jib-cloudflared

services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    network_mode: host
    command: tunnel --no-autoupdate run
    env_file:
      - ${vars.tunnelEnvPath}
`
}

export function systemdUnit(vars: CloudflaredTemplateVars): string {
  return `[Unit]
Description=Jib Cloudflared Tunnel (via docker compose)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'docker compose -f ${vars.cloudflaredDir}/docker-compose.yml up -d'
ExecStop=/bin/sh -c 'docker compose -f ${vars.cloudflaredDir}/docker-compose.yml down'

[Install]
WantedBy=multi-user.target
`
}

export const UNIT_PATH = '/etc/systemd/system/jib-cloudflared.service'
export const SERVICE_NAME = 'jib-cloudflared.service'
