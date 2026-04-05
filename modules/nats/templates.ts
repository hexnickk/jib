/**
 * Pure template functions for every file `modules/nats` writes to disk.
 * Every template is a string-returning function taking `{ busDir }` so
 * `$JIB_ROOT` can be threaded through — the systemd unit in particular
 * must reference the same compose path the install step wrote.
 *
 * These are inlined here (not loaded at runtime) so `bun build --compile`
 * bundles them into the single-file binary.
 */

export interface NatsTemplateVars {
  busDir: string
}

export function composeYaml(_vars: NatsTemplateVars): string {
  return `# Managed by jib (modules/nats) — do not edit.
# Written under \${JIB_ROOT}/bus/docker-compose.yml by the nats module install step.
name: jib-bus

services:
  nats:
    image: nats:alpine
    restart: unless-stopped
    ports:
      - "127.0.0.1:4222:4222"
    volumes:
      - ./nats.conf:/etc/nats/nats.conf:ro
    command: ["-c", "/etc/nats/nats.conf"]
`
}

export function natsConf(_vars: NatsTemplateVars): string {
  return `# Managed by jib (modules/nats) — do not edit.
#
# NATS runs with defaults from this file. The container exposes port 4222
# only on 127.0.0.1, so local-only access is the primary security boundary.
`
}

export function systemdUnit(vars: NatsTemplateVars): string {
  return `[Unit]
Description=Jib Bus (NATS via docker compose)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'docker compose -f ${vars.busDir}/docker-compose.yml up -d'
ExecStop=/bin/sh -c 'docker compose -f ${vars.busDir}/docker-compose.yml down'

[Install]
WantedBy=multi-user.target
`
}

/** Path where the systemd unit file is written. Not $JIB_ROOT-relative. */
export const UNIT_PATH = '/etc/systemd/system/jib-bus.service'
export const SERVICE_NAME = 'jib-bus.service'
