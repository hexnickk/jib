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
    deploy: 'jib.cmd.deploy',
    appUp: 'jib.cmd.app.up',
    appDown: 'jib.cmd.app.down',
    appRestart: 'jib.cmd.app.restart',
    configReload: 'jib.cmd.config.reload',
    ingressClaim: 'jib.cmd.ingress.claim',
    ingressRelease: 'jib.cmd.ingress.release',
  },
  evt: {
    deploySuccess: 'jib.evt.deploy.success',
    deployFailure: 'jib.evt.deploy.failure',
    deployProgress: 'jib.evt.deploy.progress',
    appUpSuccess: 'jib.evt.app.up.success',
    appUpFailure: 'jib.evt.app.up.failure',
    appDownSuccess: 'jib.evt.app.down.success',
    appDownFailure: 'jib.evt.app.down.failure',
    appRestartSuccess: 'jib.evt.app.restart.success',
    appRestartFailure: 'jib.evt.app.restart.failure',
    ingressReady: 'jib.evt.ingress.ready',
    ingressReleased: 'jib.evt.ingress.released',
    ingressFailed: 'jib.evt.ingress.failed',
    ingressProgress: 'jib.evt.ingress.progress',
  },
} as const

export type CmdSubject = (typeof SUBJECTS.cmd)[keyof typeof SUBJECTS.cmd]
export type EvtSubject = (typeof SUBJECTS.evt)[keyof typeof SUBJECTS.evt]
