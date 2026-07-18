import { existsSync } from 'node:fs'
import { InternalError } from '@jib/errors'
import { type DockerExec, type ExecResult, dockerRealExec } from './exec.ts'

export interface ComposeConfig {
  app: string
  dir: string
  files: string[]
  envFile?: string
  override?: string
  /** Injected exec, defaults to zx-backed docker execution — tests pass a stub. */
  exec?: DockerExec
}

export interface UpOptions {
  services?: string[]
  buildArgs?: Record<string, string>
  quiet?: boolean
}

export interface DockerCompose {
  cfg: ComposeConfig
  projectName(): string
  baseArgs(): string[]
  build(
    buildArgs?: Record<string, string>,
    opts?: { quiet?: boolean },
  ): Promise<InternalError | undefined>
  up(opts?: UpOptions): Promise<InternalError | undefined>
  down(removeVolumes?: boolean, opts?: { quiet?: boolean }): Promise<InternalError | undefined>
  restart(services?: string[], opts?: { quiet?: boolean }): Promise<InternalError | undefined>
  exec(service: string, cmd: string[]): Promise<InternalError | undefined>
  run(service: string, cmd: string[]): Promise<InternalError | undefined>
  logs(
    service?: string,
    opts?: { follow?: boolean; tail?: number },
  ): Promise<InternalError | undefined>
  ps(): Promise<ExecResult | InternalError>
}

/** Creates a plain docker-compose runner object for one app. */
export function dockerCreateCompose(cfg: ComposeConfig): DockerCompose {
  const runner = cfg.exec ?? dockerRealExec

  function projectName(): string {
    return `jib-${cfg.app}`
  }

  function baseArgs(): string[] {
    const args = ['compose', '-p', projectName()]
    for (const file of cfg.files) {
      args.push('-f', file)
    }
    if (cfg.override && existsSync(cfg.override)) {
      args.push('-f', cfg.override)
    }
    return args
  }

  function envArgs(): string[] {
    return cfg.envFile ? ['--env-file', cfg.envFile] : []
  }

  async function runResult(
    args: string[],
    opts: { env?: Record<string, string>; tty?: boolean; capture?: boolean } = {},
  ): Promise<InternalError | undefined> {
    const callOpts: Parameters<DockerExec>[1] = { cwd: cfg.dir }
    if (opts.env) {
      callOpts.env = opts.env
    }
    if (opts.tty) {
      callOpts.tty = true
    }
    if (opts.capture) {
      callOpts.capture = true
    }
    try {
      const result = await runner(args, callOpts)
      if (result.exitCode !== 0) {
        const detail = result.stderr || result.stdout
        return new InternalError(
          `${args.slice(0, 4).join(' ')} exited ${result.exitCode}: ${detail}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`${args.slice(0, 4).join(' ')} failed: ${message}`, { cause: error })
    }
  }

  async function capture(args: string[]): Promise<ExecResult | InternalError> {
    try {
      const result = await runner(args, { cwd: cfg.dir, capture: true })
      if (result.exitCode !== 0) {
        return new InternalError(
          `${args.slice(0, 4).join(' ')} exited ${result.exitCode}: ${result.stderr}`,
        )
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`${args.slice(0, 4).join(' ')} failed: ${message}`, { cause: error })
    }
  }

  return {
    cfg,
    projectName,
    baseArgs,
    async build(buildArgs: Record<string, string> = {}, opts: { quiet?: boolean } = {}) {
      const args = ['docker', ...baseArgs(), ...envArgs(), 'build']
      return runResult(args, {
        ...(Object.keys(buildArgs).length > 0 ? { env: buildArgs } : {}),
        ...(opts.quiet ? { capture: true } : {}),
      })
    },
    async up(opts: UpOptions = {}) {
      const args = [
        'docker',
        ...baseArgs(),
        ...envArgs(),
        'up',
        '-d',
        '--force-recreate',
        '--remove-orphans',
        ...(opts.services ?? []),
      ]
      return runResult(args, {
        ...(opts.buildArgs && Object.keys(opts.buildArgs).length > 0
          ? { env: opts.buildArgs }
          : {}),
        ...(opts.quiet ? { capture: true } : {}),
      })
    },
    async down(removeVolumes = false, opts: { quiet?: boolean } = {}) {
      const args = ['docker', ...baseArgs(), 'down']
      if (removeVolumes) {
        args.push('-v')
      }
      return runResult(args, opts.quiet ? { capture: true } : {})
    },
    async restart(services: string[] = [], opts: { quiet?: boolean } = {}) {
      return runResult(
        ['docker', ...baseArgs(), 'restart', ...services],
        opts.quiet ? { capture: true } : {},
      )
    },
    async exec(service: string, cmd: string[]) {
      return runResult(['docker', ...baseArgs(), 'exec', service, ...cmd], { tty: true })
    },
    async run(service: string, cmd: string[]) {
      return runResult(['docker', ...baseArgs(), ...envArgs(), 'run', '--rm', service, ...cmd], {
        tty: true,
      })
    },
    async logs(service?: string, opts: { follow?: boolean; tail?: number } = {}) {
      const args = ['docker', ...baseArgs(), ...envArgs(), 'logs']
      if (opts.follow) {
        args.push('-f')
      }
      if (opts.tail && opts.tail > 0) {
        args.push('--tail', String(opts.tail))
      }
      if (service) {
        args.push(service)
      }
      return runResult(args)
    },
    async ps() {
      return capture(['docker', ...baseArgs(), 'ps', '--format', 'json'])
    },
  }
}
