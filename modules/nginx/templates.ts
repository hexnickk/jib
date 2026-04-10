export interface SystemdUnitVars {
  jibRoot: string
  binPath: string
}

export function renderSystemdUnit(vars: SystemdUnitVars): string {
  return `[Unit]
Description=jib nginx operator
Requires=jib-bus.service
After=jib-bus.service

[Service]
Type=simple
Environment=JIB_ROOT=${vars.jibRoot}
ExecStart=${vars.binPath} start nginx
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`
}

export const NGINX_UNIT_PATH = '/etc/systemd/system/jib-nginx.service'
export const NGINX_SERVICE_NAME = 'jib-nginx.service'
