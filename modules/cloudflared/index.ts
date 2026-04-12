export const manifest = {
  name: 'cloudflared',
  description: 'Cloudflare Tunnel daemon (optional)',
} satisfies { name: string; required?: boolean; description?: string }

export {
  CloudflaredInstallError,
  CloudflaredSaveTunnelTokenError,
  CloudflaredUninstallError,
} from './errors.ts'
export { cloudflaredInstall } from './install.ts'
export { cloudflaredUninstall } from './uninstall.ts'
export {
  cloudflaredEnableService,
  cloudflaredHasTunnelToken,
  cloudflaredSaveTunnelToken,
  cloudflaredTunnelTokenPath,
} from './service.ts'
export { cloudflaredReadStatus } from './status.ts'
export { cloudflaredExtractTunnelToken } from './token.ts'
