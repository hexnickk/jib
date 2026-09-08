import { systemdStartManagedServicesResult } from '@jib/systemd'
import type { JibMigration } from './types.ts'

export const m0012_start_managed_services: JibMigration = {
  id: '0012_start_managed_services',
  description: 'Start Jib services after Docker installation',
  async up(ctx) {
    return await systemdStartManagedServicesResult(ctx.paths.configFile)
  },
}
