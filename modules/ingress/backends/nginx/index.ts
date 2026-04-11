import type { IngressBackend } from '../types.ts'
import { install } from './install.ts'
import { createNginxIngressOperator } from './operator.ts'
import { uninstall } from './uninstall.ts'

export const nginxBackend: IngressBackend = {
  name: 'nginx',
  createOperator: (paths) => createNginxIngressOperator({ nginxDir: paths.nginxDir }),
  install,
  uninstall,
}
