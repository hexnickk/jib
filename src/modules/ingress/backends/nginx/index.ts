import type { IngressBackend } from '../types.ts'
import { ingressInstall } from './install.ts'
import { ingressCreateNginxOperator } from './operator.ts'
import { ingressUninstall } from './uninstall.ts'

export const nginxBackend: IngressBackend = {
  name: 'nginx',
  createOperator: (paths) => ingressCreateNginxOperator({ nginxDir: paths.nginxDir }),
  install: ingressInstall,
  uninstall: ingressUninstall,
}
