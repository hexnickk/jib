import { existsSync } from 'node:fs'
import { JibError } from '@jib/errors'
import { type DockerExec, type ExecResult, dockerRealExec } from './exec.ts'

export interface ComposeConfig {
  app: string
  dir: string
  files: string[]
  envFile?: string
  override?: string
  /** Injected exec, defaults to Bun.$ — tests pass a stub. */
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
  build(buildArgs?: Record<string, string>, opts?: { quiet?: boolean }): Promise<void>
  up(opts?: UpOptions): Promise<void>
  down(removeVolumes?: boolean, opts?: { quiet?: boolean }): Promise<void>
  restart(services?: string[], opts?: { quiet?: boolean }): Promise<void>
  exec(service: string, cmd: string[]): Promise<void>
  run(service: string, cmd: string[]): Promise<void>
  logs(service?: string, opts?: { follow?: boolean; tail?: number }): Promise<void>
  ps(): Promise<ExecResult>
}

/** Creates a plain docker-compose runner object for one app. */
export function dockerCreateCompose(cfg: ComposeConfig): DockerCompose {
  const runner = cfg.exec ?? dockerRealExec

  function projectName(): string {
    return `jib-${cfg.app}`
  }

  function baseArgs(): string[] {
    const args = ['compose', '-p', projectName()]
    for (const f of cfg.files) args.push('-f', f)
    if (cfg.override && existsSync(cfg.override)) {
      args.push('-f', cfg.override)
    }
    return args
  }

  function envArgs(): string[] {
    return cfg.envFile ? ['--env-file', cfg.envFile] : []
  }

  async function runOrThrow(
    args: string[],
    opts: { env?: Record<string, string>; tty?: boolean; capture?: boolean } = {},
  ): Promise<void> {
    const callOpts: Parameters<DockerExec>[1] = { cwd: cfg.dir }
    if (opts.env) callOpts.env = opts.env
    if (opts.tty) callOpts.tty = true
    if (opts.capture) callOpts.capture = true
    const res = await runner(args, callOpts)
    if (res.exitCode !== 0) {
      const detail = res.stderr || res.stdout
      throw new JibError(
        'docker',
        `${args.slice(0, 4).join(' ')} exited ${res.exitCode}: ${detail}`,
      )
    }
  }

  async function capture(args: string[]): Promise<ExecResult> {
    const res = await runner(args, { cwd: cfg.dir, capture: true })
    if (res.exitCode !== 0) {
      throw new JibError(
        'docker',
        `${args.slice(0, 4).join(' ')} exited ${res.exitCode}: ${res.stderr}`,
      )
    }
    return res
  }

  return {
    cfg,
    projectName,
    baseArgs,
    async build(buildArgs: Record<string, string> = {}, opts: { quiet?: boolean } = {}) {
      const args = ['docker', ...baseArgs(), ...envArgs(), 'build']
      await runOrThrow(args, {
        env: buildArgs,
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
      await runOrThrow(args, {
        ...(opts.buildArgs ? { env: opts.buildArgs } : {}),
        ...(opts.quiet ? { capture: true } : {}),
      })
    },
    async down(removeVolumes = false, opts: { quiet?: boolean } = {}) {
      const args = ['docker', ...baseArgs(), 'down']
      if (removeVolumes) args.push('-v')
      await runOrThrow(args, opts.quiet ? { capture: true } : {})
    },
    async restart(services: string[] = [], opts: { quiet?: boolean } = {}) {
      await runOrThrow(
        ['docker', ...baseArgs(), 'restart', ...services],
        opts.quiet ? { capture: true } : {},
      )
    },
    async exec(service: string, cmd: string[]) {
      await runOrThrow(['docker', ...baseArgs(), 'exec', service, ...cmd], { tty: true })
    },
    async run(service: string, cmd: string[]) {
      await runOrThrow(['docker', ...baseArgs(), ...envArgs(), 'run', '--rm', service, ...cmd], {
        tty: true,
      })
    },
    async logs(service?: string, opts: { follow?: boolean; tail?: number } = {}) {
      const args = ['docker', ...baseArgs(), 'logs']
      if (opts.follow) args.push('-f')
      if (opts.tail && opts.tail > 0) args.push('--tail', String(opts.tail))
      if (service) args.push(service)
      await runOrThrow(args)
    },
    async ps() {
      return capture(['docker', ...baseArgs(), 'ps', '--format', 'json'])
    },
  }
}
