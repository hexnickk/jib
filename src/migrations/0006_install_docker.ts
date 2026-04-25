import { dockerEnsureInstalledResult } from '@jib/docker'
import type { JibMigration } from './types.ts'

export const m0006_install_docker: JibMigration = {
  id: '0006_install_docker',
  description: 'Install Docker Engine and Compose plugin',
  up: async () => {
    const error = await dockerEnsureInstalledResult()
    if (error) throw error
  },
}
