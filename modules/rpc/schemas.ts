import { z } from 'zod'
import { SUBJECTS } from './subjects.ts'

/**
 * Every message on the bus (command or event) carries the same envelope so
 * consumers can filter by correlation ID and trace origins. Command/event
 * bodies extend this via `.extend`.
 */
export const EnvelopeSchema = z.object({
  corrId: z.string().min(1),
  ts: z.string().datetime(),
  source: z.string().min(1),
})
export type Envelope = z.infer<typeof EnvelopeSchema>

const app = z.string().min(1)

export const CmdDeploySchema = EnvelopeSchema.extend({
  app,
  workdir: z.string().min(1),
  sha: z.string().min(1),
  trigger: z.enum(['manual', 'auto']),
  user: z.string().optional(),
})
export const CmdAppUpSchema = EnvelopeSchema.extend({ app })
export const CmdAppDownSchema = EnvelopeSchema.extend({
  app,
  volumes: z.boolean().default(false),
})
export const CmdAppRestartSchema = EnvelopeSchema.extend({ app })
export const CmdConfigReloadSchema = EnvelopeSchema

export const EvtDeploySuccessSchema = EnvelopeSchema.extend({
  app,
  sha: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
})
export const EvtDeployFailureSchema = EnvelopeSchema.extend({
  app,
  error: z.string(),
  step: z.string().optional(),
})
export const EvtDeployProgressSchema = EnvelopeSchema.extend({
  app,
  step: z.string(),
  message: z.string(),
})

export const EvtAppUpSuccessSchema = EnvelopeSchema.extend({ app })
export const EvtAppUpFailureSchema = EnvelopeSchema.extend({ app, error: z.string() })
export const EvtAppDownSuccessSchema = EnvelopeSchema.extend({ app })
export const EvtAppDownFailureSchema = EnvelopeSchema.extend({ app, error: z.string() })
export const EvtAppRestartSuccessSchema = EnvelopeSchema.extend({ app })
export const EvtAppRestartFailureSchema = EnvelopeSchema.extend({ app, error: z.string() })

const port = z.number().int().min(1).max(65535)
export const CmdIngressClaimSchema = EnvelopeSchema.extend({
  app,
  // `hasSSL` intentionally absent: whether a host has a TLS cert is a
  // filesystem property of the server, not something the CLI can know or
  // care about. The ingress adapter probes the host at render time.
  // `isTunnel` stays because it's a user-declared intent.
  domains: z
    .array(
      z.object({
        host: z.string().min(1),
        port,
        isTunnel: z.boolean().default(false),
      }),
    )
    .min(1),
})
export const CmdIngressReleaseSchema = EnvelopeSchema.extend({ app })

export const EvtIngressReadySchema = EnvelopeSchema.extend({ app })
export const EvtIngressReleasedSchema = EnvelopeSchema.extend({ app })
export const EvtIngressFailedSchema = EnvelopeSchema.extend({ app, error: z.string() })
export const EvtIngressProgressSchema = EnvelopeSchema.extend({ app, message: z.string() })

export type CmdDeploy = z.infer<typeof CmdDeploySchema>
export type CmdAppUp = z.infer<typeof CmdAppUpSchema>
export type CmdAppDown = z.infer<typeof CmdAppDownSchema>
export type CmdAppRestart = z.infer<typeof CmdAppRestartSchema>
export type CmdConfigReload = z.infer<typeof CmdConfigReloadSchema>

export type EvtDeploySuccess = z.infer<typeof EvtDeploySuccessSchema>
export type EvtDeployFailure = z.infer<typeof EvtDeployFailureSchema>
export type EvtDeployProgress = z.infer<typeof EvtDeployProgressSchema>
export type EvtAppUpSuccess = z.infer<typeof EvtAppUpSuccessSchema>
export type EvtAppUpFailure = z.infer<typeof EvtAppUpFailureSchema>
export type EvtAppDownSuccess = z.infer<typeof EvtAppDownSuccessSchema>
export type EvtAppDownFailure = z.infer<typeof EvtAppDownFailureSchema>
export type EvtAppRestartSuccess = z.infer<typeof EvtAppRestartSuccessSchema>
export type EvtAppRestartFailure = z.infer<typeof EvtAppRestartFailureSchema>

export type CmdIngressClaim = z.infer<typeof CmdIngressClaimSchema>
export type CmdIngressRelease = z.infer<typeof CmdIngressReleaseSchema>

export type EvtIngressReady = z.infer<typeof EvtIngressReadySchema>
export type EvtIngressReleased = z.infer<typeof EvtIngressReleasedSchema>
export type EvtIngressFailed = z.infer<typeof EvtIngressFailedSchema>
export type EvtIngressProgress = z.infer<typeof EvtIngressProgressSchema>

/**
 * Lookup table from subject to schema. Used by `emitAndWait`/`handleCmd` to
 * validate messages without callers threading schemas in by hand.
 */
export const SCHEMAS = {
  [SUBJECTS.cmd.deploy]: CmdDeploySchema,
  [SUBJECTS.cmd.appUp]: CmdAppUpSchema,
  [SUBJECTS.cmd.appDown]: CmdAppDownSchema,
  [SUBJECTS.cmd.appRestart]: CmdAppRestartSchema,
  [SUBJECTS.cmd.configReload]: CmdConfigReloadSchema,
  [SUBJECTS.evt.deploySuccess]: EvtDeploySuccessSchema,
  [SUBJECTS.evt.deployFailure]: EvtDeployFailureSchema,
  [SUBJECTS.evt.deployProgress]: EvtDeployProgressSchema,
  [SUBJECTS.evt.appUpSuccess]: EvtAppUpSuccessSchema,
  [SUBJECTS.evt.appUpFailure]: EvtAppUpFailureSchema,
  [SUBJECTS.evt.appDownSuccess]: EvtAppDownSuccessSchema,
  [SUBJECTS.evt.appDownFailure]: EvtAppDownFailureSchema,
  [SUBJECTS.evt.appRestartSuccess]: EvtAppRestartSuccessSchema,
  [SUBJECTS.evt.appRestartFailure]: EvtAppRestartFailureSchema,
  [SUBJECTS.cmd.ingressClaim]: CmdIngressClaimSchema,
  [SUBJECTS.cmd.ingressRelease]: CmdIngressReleaseSchema,
  [SUBJECTS.evt.ingressReady]: EvtIngressReadySchema,
  [SUBJECTS.evt.ingressReleased]: EvtIngressReleasedSchema,
  [SUBJECTS.evt.ingressFailed]: EvtIngressFailedSchema,
  [SUBJECTS.evt.ingressProgress]: EvtIngressProgressSchema,
} as const satisfies Record<string, z.ZodTypeAny>
