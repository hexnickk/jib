export const manifest = {
  name: 'ingress',
  required: true,
  description: 'Ingress reverse proxy (nginx backend)',
} satisfies { name: string; required?: boolean; description?: string }

export { ingressGetExec } from './exec.ts'
export { ingressCreateOperator, ingressDefaultBackend } from './backends/index.ts'
export { IngressMissingPortError, NginxIngressReloadError } from './errors.ts'
export { ingressBuildClaim, ingressClaim, ingressRelease } from './service.ts'
export { ingressInstall } from './install.ts'
export { ingressUninstall } from './uninstall.ts'
export type { IngressBackend } from './backends/types.ts'
export type { ExecFn, ExecResult } from './exec.ts'
export type { IngressClaim, IngressDomain, IngressOperator, IngressProgress } from './types.ts'
