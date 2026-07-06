import { CliError, cliIsTextOutput } from '@jib/cli'
import { configLoadContext, configNormalizeByteSize, configWrite } from '@jib/config'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { ingressApplyNginxConfig } from '../modules/ingress/backends/nginx/config.ts'
import { cmdCreateHandler } from './handler.ts'

interface IngressSetArgs {
  maxBodySize?: string
}

const cliIngressCommands = [
  {
    command: 'ingress set',
    describe: 'Configure ingress settings',
    builder: {
      'max-body-size': {
        type: 'string',
        demandOption: true,
        description: 'Maximum accepted HTTP request body size, e.g. 10m or 25mb',
      },
    },
    handler: cmdCreateHandler(ingressSetRunCommand),
  },
] satisfies CommandModule<Record<string, unknown>, IngressSetArgs>[]

/** Persists ingress settings and applies them to the current nginx ingress implementation. */
async function ingressSetRunCommand(args: ArgumentsCamelCase<IngressSetArgs>) {
  const maxBodySize = typeof args.maxBodySize === 'string' ? args.maxBodySize : ''
  const normalized = configNormalizeByteSize(maxBodySize)
  if (!normalized) {
    return new CliError('invalid_ingress_max_body_size', 'invalid ingress max body size', {
      issues: [
        {
          field: 'max-body-size',
          message: 'use an integer byte count or k/m/g size like 1048576, 10m, or 25mb',
        },
      ],
    })
  }

  const loaded = await configLoadContext()
  if (loaded instanceof Error) return loaded
  const { cfg, paths } = loaded
  const nextCfg = { ...cfg, ingress: { ...(cfg.ingress ?? {}), max_body_size: normalized } }
  const writeError = await configWrite(paths.configFile, nextCfg)
  if (writeError instanceof Error) return writeError
  const applyError = await ingressApplyNginxConfig(paths, nextCfg)
  if (applyError instanceof Error) return applyError

  if (cliIsTextOutput()) process.stdout.write(`ingress max body size set to ${normalized}\n`)
  return { maxBodySize: normalized }
}

export default cliIngressCommands
