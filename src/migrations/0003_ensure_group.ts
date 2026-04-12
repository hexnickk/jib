import { GROUP } from './helpers.ts'
import type { JibMigration } from './types.ts'

export const m0003_ensure_group: JibMigration = {
  id: '0003_ensure_group',
  description: 'Create jib group, set ownership, add invoking user',
  up: async (ctx) => {
    await Bun.$`groupadd --system ${GROUP} 2>/dev/null || true`.quiet()
    await Bun.$`chown -R root:${GROUP} ${ctx.paths.root}`.quiet().nothrow()
    await Bun.$`chmod -R g+rwXs ${ctx.paths.root}`.quiet().nothrow()
    await Bun.$`chmod 640 ${ctx.paths.configFile}`.quiet().nothrow()

    const sudoUser = process.env.SUDO_USER
    if (sudoUser) {
      await Bun.$`usermod -aG ${GROUP} ${sudoUser}`.quiet().nothrow()
    }
  },
}
