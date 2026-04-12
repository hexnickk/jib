import { repairManagedSecretsTree } from './secrets.ts'
import type { JibMigration } from './types.ts'

export const m0011_repair_managed_secret_permissions: JibMigration = {
  id: '0011_repair_managed_secret_permissions',
  description: 'Repair jib-managed secret tree permissions',
  up: async (ctx) => {
    await repairManagedSecretsTree(ctx.paths)
  },
}
