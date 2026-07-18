import { mkdir, rm } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { InternalError, type JibError, NotFoundError, ValidationError } from '@jib/errors'
import { type Paths, pathsDockerHubImage, pathsRepoPath } from '@jib/paths'
import * as git from './git.ts'
import { resolveSourceDriverResult } from './registry.ts'
import { sourcesSyncLocalCheckout, sourcesSyncRemoteCheckout } from './sync.ts'
import type {
  InspectionCheckout,
  PreparedSource,
  ProbeSourceDeps,
  ResolvedSource,
  SourceProbe,
  SourceTarget,
} from './types.ts'

/** Resolves a configured app or synthesizes one for a not-yet-configured add target. */
function resolveTargetApp(cfg: Config, target: SourceTarget): App | NotFoundError {
  const existing = cfg.apps[target.app]
  if (existing) {
    return existing
  }
  if (!target.repo) {
    return new NotFoundError(`app "${target.app}" not found in config`)
  }
  const image = pathsDockerHubImage(target.repo)
  return {
    repo: image ? 'local' : target.repo,
    branch: target.branch ?? 'main',
    domains: [],
    ...(image ? { image } : {}),
    ...(target.source ? { source: target.source } : {}),
  }
}

/** Resolves remote metadata for a source target without creating a checkout. */
export async function sourcesResolve(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  ref?: string,
): Promise<ResolvedSource | JibError> {
  const existing = cfg.apps[target.app]
  const app = resolveTargetApp(cfg, target)
  if (app instanceof Error) {
    return app
  }
  if (app.repo === 'local') {
    return new ValidationError(`app "${target.app}" uses a local repo and has no remote source`)
  }
  const workdir = pathsRepoPath(paths, target.app, app.repo)
  const driver = resolveSourceDriverResult(cfg, app)
  if (driver instanceof Error) {
    return driver
  }

  const remote = await driver.resolve(cfg, app, paths)
  if (remote instanceof Error) {
    return remote
  }

  const defaultBranch =
    target.branch || existing?.branch
      ? undefined
      : await git.sourcesGitDefaultBranch(remote.url, remote.env)
  if (defaultBranch instanceof Error) {
    return defaultBranch
  }

  const branch = target.branch ?? existing?.branch ?? defaultBranch ?? app.branch
  return {
    app: app.branch === branch ? app : { ...app, branch },
    branch,
    ref: ref ?? branch,
    workdir,
    ...remote,
  }
}

/** Ensures the local workdir is ready for inspection or deploy and returns the pinned SHA. */
export async function sourcesSync(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  ref?: string,
): Promise<PreparedSource | JibError> {
  const app = resolveTargetApp(cfg, target)
  if (app instanceof Error) {
    return app
  }

  if (app.image) {
    const workdir = pathsRepoPath(paths, target.app, app.repo)
    try {
      await mkdir(workdir, { recursive: true, mode: 0o750 })
    } catch (error) {
      return new InternalError(`failed to prepare checkout for app "${target.app}" at ${workdir}`, {
        cause: error,
      })
    }
    return { workdir, sha: app.image }
  }

  if (app.repo === 'local') {
    return sourcesSyncLocalCheckout(
      target.app,
      pathsRepoPath(paths, target.app, app.repo),
      ref ?? app.branch,
    )
  }

  const source = await sourcesResolve(cfg, paths, target, ref)
  if (source instanceof Error) {
    return source
  }
  return sourcesSyncRemoteCheckout(target.app, source)
}

/** Prepares a checkout for compose inspection and returns the inspection workdir. */
export async function sourcesCloneForInspection(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
): Promise<InspectionCheckout | JibError> {
  const prepared = await sourcesSync(cfg, paths, target)
  if (prepared instanceof Error) {
    return prepared
  }
  return { workdir: prepared.workdir }
}

/** Resolves the remote SHA for a source target without mutating the local checkout. */
export async function sourcesProbe(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  deps: ProbeSourceDeps = {},
): Promise<SourceProbe | JibError | null> {
  const app = resolveTargetApp(cfg, target)
  if (app instanceof Error) {
    return app
  }
  if (app.repo === 'local') {
    return null
  }

  const source = await sourcesResolve(cfg, paths, target)
  if (source instanceof Error) {
    return source
  }
  const lsRemote = deps.lsRemote ?? git.sourcesGitLsRemote

  try {
    const sha = await lsRemote(source.url, source.ref, source.env)
    if (sha instanceof Error) {
      return sha
    }
    return sha ? { branch: source.branch, workdir: source.workdir, sha } : null
  } catch (error) {
    return new InternalError(
      `failed to probe source for app "${target.app}" at ref "${source.ref}"`,
      {
        cause: error,
      },
    )
  }
}

/** Removes a source checkout directory and returns a typed filesystem error on failure. */
export async function sourcesRemoveCheckout(
  paths: Paths,
  app: string,
  repo: string,
): Promise<InternalError | undefined> {
  const workdir = pathsRepoPath(paths, app, repo)
  try {
    await rm(workdir, { recursive: true, force: true })
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`remove source checkout ${workdir}: ${message}`, { cause: error })
  }
}
