export const manifest = {
  name: 'cloudflared',
  description: 'Cloudflare Tunnel daemon (optional)',
} satisfies { name: string; required?: boolean; description?: string }

export {
  CloudflaredInstallCreateDirError,
  CloudflaredInstallError,
  CloudflaredInstallReloadError,
  CloudflaredInstallWriteComposeError,
  CloudflaredInstallWriteUnitError,
  CloudflaredSaveTunnelTokenError,
  CloudflaredUninstallError,
  CloudflaredUninstallDisableError,
  CloudflaredUninstallReloadError,
  CloudflaredUninstallRemoveComposeError,
  CloudflaredUninstallRemoveUnitError,
} from './errors.ts'
export {
  cloudflaredInstallResult,
  cloudflaredInstall,
} from './install.ts'
export {
  cloudflaredUninstallResult,
  cloudflaredUninstall,
} from './uninstall.ts'
export {
  cloudflaredEnableService,
  cloudflaredHasTunnelToken,
  cloudflaredSaveTunnelToken,
  cloudflaredTunnelTokenPath,
} from './service.ts'
export { cloudflaredReadStatus } from './status.ts'
export { cloudflaredExtractTunnelToken } from './token.ts'
