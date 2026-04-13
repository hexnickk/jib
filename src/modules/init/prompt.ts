import { promptConfirm } from '@jib/tui'
import type { ModLike } from './registry.ts'

/** Prompts for a single optional module so init can configure them one by one. */
export function initPromptOptionalModule(mod: ModLike): Promise<boolean> {
  return promptConfirm({
    message:
      `Enable optional module "${mod.manifest.name}"? ${mod.manifest.description ?? ''}`.trim(),
    initialValue: false,
  })
}
