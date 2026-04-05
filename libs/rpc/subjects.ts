/**
 * Flat subject namespace for jib's event-driven RPC. Commands (`cmd.*`) are
 * published by one service and consumed by exactly one handler via a queue
 * group; events (`evt.*`) carry correlation IDs and are filtered client-side.
 *
 * No per-app subject hierarchy — routing is by `corrId` in the payload. That
 * keeps wildcard subscriptions trivial and matches the Go implementation.
 */
export const SUBJECTS = {
  cmd: {
    repoPrepare: 'jib.cmd.repo.prepare',
    repoRemove: 'jib.cmd.repo.remove',
    deploy: 'jib.cmd.deploy',
    appUp: 'jib.cmd.app.up',
    appDown: 'jib.cmd.app.down',
    appRestart: 'jib.cmd.app.restart',
    configReload: 'jib.cmd.config.reload',
    nginxClaim: 'jib.cmd.nginx.claim',
    nginxRelease: 'jib.cmd.nginx.release',
    cloudflareDomainAdd: 'jib.cmd.cloudflare.domain.add',
    cloudflareDomainRemove: 'jib.cmd.cloudflare.domain.remove',
  },
  evt: {
    repoReady: 'jib.evt.repo.ready',
    repoRemoved: 'jib.evt.repo.removed',
    repoFailed: 'jib.evt.repo.failed',
    repoProgress: 'jib.evt.repo.progress',
    deploySuccess: 'jib.evt.deploy.success',
    deployFailure: 'jib.evt.deploy.failure',
    deployProgress: 'jib.evt.deploy.progress',
    appUpSuccess: 'jib.evt.app.up.success',
    appUpFailure: 'jib.evt.app.up.failure',
    appDownSuccess: 'jib.evt.app.down.success',
    appDownFailure: 'jib.evt.app.down.failure',
    appRestartSuccess: 'jib.evt.app.restart.success',
    appRestartFailure: 'jib.evt.app.restart.failure',
    nginxReady: 'jib.evt.nginx.ready',
    nginxReleased: 'jib.evt.nginx.released',
    nginxFailed: 'jib.evt.nginx.failed',
    nginxProgress: 'jib.evt.nginx.progress',
    cloudflareDomainReady: 'jib.evt.cloudflare.domain.ready',
    cloudflareDomainRemoved: 'jib.evt.cloudflare.domain.removed',
    cloudflareDomainFailed: 'jib.evt.cloudflare.domain.failed',
    cloudflareDomainProgress: 'jib.evt.cloudflare.domain.progress',
  },
} as const

export type CmdSubject = (typeof SUBJECTS.cmd)[keyof typeof SUBJECTS.cmd]
export type EvtSubject = (typeof SUBJECTS.evt)[keyof typeof SUBJECTS.evt]
