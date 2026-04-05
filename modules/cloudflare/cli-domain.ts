import { withBus } from '@jib/bus'
import { type EvtCloudflareDomainProgress, SUBJECTS, emitAndWait } from '@jib/rpc'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'

/**
 * `jib cloudflare add-domain|remove-domain` subcommands + the `emitDomainAdd`
 * helper reused by `cli.ts`'s interactive setup. These go through the
 * long-running cloudflare operator via `emitAndWait`, so the bus must be up
 * (`jib-bus.service`) and the operator reachable (`jib-cloudflare.service`).
 */

const DOMAIN_TIMEOUT_MS = 60_000

export async function emitDomainAdd(rootDomain: string): Promise<void> {
  const s = spinner()
  s.start(`adding ${rootDomain} to cloudflare tunnel`)
  try {
    await withBus((bus) =>
      emitAndWait(
        bus,
        SUBJECTS.cmd.cloudflareDomainAdd,
        { rootDomain },
        {
          success: SUBJECTS.evt.cloudflareDomainReady,
          failure: SUBJECTS.evt.cloudflareDomainFailed,
        },
        SUBJECTS.evt.cloudflareDomainProgress,
        {
          source: 'cli',
          timeoutMs: DOMAIN_TIMEOUT_MS,
          onProgress: (p: EvtCloudflareDomainProgress) => s.message(p.message),
        },
      ),
    )
    s.stop(`cloudflare: ${rootDomain} ready`)
  } catch (err) {
    s.stop(`cloudflare: ${rootDomain} failed`)
    throw err
  }
}

async function emitDomainRemove(rootDomain: string): Promise<void> {
  const s = spinner()
  s.start(`removing ${rootDomain} from cloudflare tunnel`)
  try {
    await withBus((bus) =>
      emitAndWait(
        bus,
        SUBJECTS.cmd.cloudflareDomainRemove,
        { rootDomain },
        {
          success: SUBJECTS.evt.cloudflareDomainRemoved,
          failure: SUBJECTS.evt.cloudflareDomainFailed,
        },
        SUBJECTS.evt.cloudflareDomainProgress,
        {
          source: 'cli',
          timeoutMs: DOMAIN_TIMEOUT_MS,
          onProgress: (p: EvtCloudflareDomainProgress) => s.message(p.message),
        },
      ),
    )
    s.stop(`cloudflare: ${rootDomain} removed`)
  } catch (err) {
    s.stop(`cloudflare: ${rootDomain} failed`)
    throw err
  }
}

export const addDomain = defineCommand({
  meta: { name: 'add-domain', description: 'Add a root domain wildcard to the tunnel' },
  args: { rootDomain: { type: 'positional', required: true } },
  async run({ args }) {
    try {
      await emitDomainAdd(args.rootDomain)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})

export const removeDomain = defineCommand({
  meta: { name: 'remove-domain', description: 'Remove a root domain from the tunnel' },
  args: { rootDomain: { type: 'positional', required: true } },
  async run({ args }) {
    try {
      await emitDomainRemove(args.rootDomain)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})
