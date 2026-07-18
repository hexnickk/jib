export const manifest = {
  name: 'cloudflared',
  description: 'Cloudflare Tunnel daemon (optional)',
} satisfies { name: string; required?: boolean; description?: string }

export { cloudflaredInstallResult } from './install.ts'
export { cloudflaredUninstallResult } from './uninstall.ts'
export {
  cloudflaredEnableConfig,
  cloudflaredEnableService,
  cloudflaredHasTunnelToken,
  cloudflaredSaveTunnelToken,
  cloudflaredTunnelTokenPath,
} from './service.ts'
export { cloudflaredReadStatus } from './status.ts'
export { cloudflaredExtractTunnelToken } from './token.ts'
