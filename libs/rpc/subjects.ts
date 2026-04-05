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
    rollback: 'jib.cmd.rollback',
    resume: 'jib.cmd.resume',
    configReload: 'jib.cmd.config.reload',
  },
  evt: {
    repoReady: 'jib.evt.repo.ready',
    repoRemoved: 'jib.evt.repo.removed',
    repoFailed: 'jib.evt.repo.failed',
    repoProgress: 'jib.evt.repo.progress',
    deploySuccess: 'jib.evt.deploy.success',
    deployFailure: 'jib.evt.deploy.failure',
    deployProgress: 'jib.evt.deploy.progress',
    rollbackSuccess: 'jib.evt.rollback.success',
    rollbackFailure: 'jib.evt.rollback.failure',
    rollbackProgress: 'jib.evt.rollback.progress',
    resumeSuccess: 'jib.evt.resume.success',
    resumeFailure: 'jib.evt.resume.failure',
  },
} as const

export type CmdSubject = (typeof SUBJECTS.cmd)[keyof typeof SUBJECTS.cmd]
export type EvtSubject = (typeof SUBJECTS.evt)[keyof typeof SUBJECTS.evt]
