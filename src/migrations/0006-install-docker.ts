import { dockerEnsureInstalledResult } from '@jib/docker'
import { DOCKER_GROUP, migrationEnsureUserInGroupResult } from './helpers.ts'
import type { JibMigration } from './types.ts'

export const m0006_install_docker: JibMigration = {
  id: '0006_install_docker',
  description: 'Install Docker Engine and Compose plugin, add invoking user to Docker group',
  async up() {
    const installError = await dockerEnsureInstalledResult()
    if (installError) {
      return installError
    }

    const sudoUser = process.env.SUDO_USER
    if (!sudoUser || sudoUser === 'root') {
      return undefined
    }
    return await migrationEnsureUserInGroupResult(sudoUser, DOCKER_GROUP)
  },
}
