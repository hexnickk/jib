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

export const CmdRepoPrepareSchema = EnvelopeSchema.extend({
  app,
  ref: z.string().min(1).optional(),
})
export const CmdRepoRemoveSchema = EnvelopeSchema.extend({ app })
export const CmdDeploySchema = EnvelopeSchema.extend({
  app,
  workdir: z.string().min(1),
  sha: z.string().min(1),
  trigger: z.enum(['manual', 'auto']),
  user: z.string().optional(),
})
export const CmdRollbackSchema = EnvelopeSchema.extend({ app })
export const CmdResumeSchema = EnvelopeSchema.extend({ app })
export const CmdConfigReloadSchema = EnvelopeSchema

export const EvtRepoReadySchema = EnvelopeSchema.extend({
  app,
  workdir: z.string().min(1),
  sha: z.string().min(1),
})
export const EvtRepoRemovedSchema = EnvelopeSchema.extend({ app })
export const EvtRepoFailedSchema = EnvelopeSchema.extend({ app, error: z.string() })
export const EvtRepoProgressSchema = EnvelopeSchema.extend({ app, message: z.string() })

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

export const EvtRollbackSuccessSchema = EnvelopeSchema.extend({ app })
export const EvtRollbackFailureSchema = EnvelopeSchema.extend({ app, error: z.string() })
export const EvtRollbackProgressSchema = EnvelopeSchema.extend({
  app,
  step: z.string(),
  message: z.string(),
})
export const EvtResumeSuccessSchema = EnvelopeSchema.extend({ app })
export const EvtResumeFailureSchema = EnvelopeSchema.extend({ app, error: z.string() })

const port = z.number().int().min(1).max(65535)
const rootDomain = z.string().min(1)

export const CmdNginxClaimSchema = EnvelopeSchema.extend({
  app,
  domains: z
    .array(
      z.object({
        host: z.string().min(1),
        port,
        containerPort: port,
        isTunnel: z.boolean().default(false),
        hasSSL: z.boolean().default(false),
      }),
    )
    .min(1),
})
export const CmdNginxReleaseSchema = EnvelopeSchema.extend({ app })
export const CmdCloudflareDomainAddSchema = EnvelopeSchema.extend({ rootDomain })
export const CmdCloudflareDomainRemoveSchema = EnvelopeSchema.extend({ rootDomain })

export const EvtNginxReadySchema = EnvelopeSchema.extend({ app })
export const EvtNginxReleasedSchema = EnvelopeSchema.extend({ app })
export const EvtNginxFailedSchema = EnvelopeSchema.extend({ app, error: z.string() })
export const EvtNginxProgressSchema = EnvelopeSchema.extend({ app, message: z.string() })

export const EvtCloudflareDomainReadySchema = EnvelopeSchema.extend({ rootDomain })
export const EvtCloudflareDomainRemovedSchema = EnvelopeSchema.extend({ rootDomain })
export const EvtCloudflareDomainFailedSchema = EnvelopeSchema.extend({
  rootDomain,
  error: z.string(),
})
export const EvtCloudflareDomainProgressSchema = EnvelopeSchema.extend({
  rootDomain,
  message: z.string(),
})

export type CmdRepoPrepare = z.infer<typeof CmdRepoPrepareSchema>
export type CmdRepoRemove = z.infer<typeof CmdRepoRemoveSchema>
export type CmdDeploy = z.infer<typeof CmdDeploySchema>
export type CmdRollback = z.infer<typeof CmdRollbackSchema>
export type CmdResume = z.infer<typeof CmdResumeSchema>
export type CmdConfigReload = z.infer<typeof CmdConfigReloadSchema>

export type EvtRepoReady = z.infer<typeof EvtRepoReadySchema>
export type EvtRepoRemoved = z.infer<typeof EvtRepoRemovedSchema>
export type EvtRepoFailed = z.infer<typeof EvtRepoFailedSchema>
export type EvtRepoProgress = z.infer<typeof EvtRepoProgressSchema>
export type EvtDeploySuccess = z.infer<typeof EvtDeploySuccessSchema>
export type EvtDeployFailure = z.infer<typeof EvtDeployFailureSchema>
export type EvtDeployProgress = z.infer<typeof EvtDeployProgressSchema>
export type EvtRollbackSuccess = z.infer<typeof EvtRollbackSuccessSchema>
export type EvtRollbackFailure = z.infer<typeof EvtRollbackFailureSchema>
export type EvtRollbackProgress = z.infer<typeof EvtRollbackProgressSchema>
export type EvtResumeSuccess = z.infer<typeof EvtResumeSuccessSchema>
export type EvtResumeFailure = z.infer<typeof EvtResumeFailureSchema>

export type CmdNginxClaim = z.infer<typeof CmdNginxClaimSchema>
export type CmdNginxRelease = z.infer<typeof CmdNginxReleaseSchema>
export type CmdCloudflareDomainAdd = z.infer<typeof CmdCloudflareDomainAddSchema>
export type CmdCloudflareDomainRemove = z.infer<typeof CmdCloudflareDomainRemoveSchema>

export type EvtNginxReady = z.infer<typeof EvtNginxReadySchema>
export type EvtNginxReleased = z.infer<typeof EvtNginxReleasedSchema>
export type EvtNginxFailed = z.infer<typeof EvtNginxFailedSchema>
export type EvtNginxProgress = z.infer<typeof EvtNginxProgressSchema>
export type EvtCloudflareDomainReady = z.infer<typeof EvtCloudflareDomainReadySchema>
export type EvtCloudflareDomainRemoved = z.infer<typeof EvtCloudflareDomainRemovedSchema>
export type EvtCloudflareDomainFailed = z.infer<typeof EvtCloudflareDomainFailedSchema>
export type EvtCloudflareDomainProgress = z.infer<typeof EvtCloudflareDomainProgressSchema>

/**
 * Lookup table from subject to schema. Used by `emitAndWait`/`handleCmd` to
 * validate messages without callers threading schemas in by hand.
 */
export const SCHEMAS = {
  [SUBJECTS.cmd.repoPrepare]: CmdRepoPrepareSchema,
  [SUBJECTS.cmd.repoRemove]: CmdRepoRemoveSchema,
  [SUBJECTS.cmd.deploy]: CmdDeploySchema,
  [SUBJECTS.cmd.rollback]: CmdRollbackSchema,
  [SUBJECTS.cmd.resume]: CmdResumeSchema,
  [SUBJECTS.cmd.configReload]: CmdConfigReloadSchema,
  [SUBJECTS.evt.repoReady]: EvtRepoReadySchema,
  [SUBJECTS.evt.repoRemoved]: EvtRepoRemovedSchema,
  [SUBJECTS.evt.repoFailed]: EvtRepoFailedSchema,
  [SUBJECTS.evt.repoProgress]: EvtRepoProgressSchema,
  [SUBJECTS.evt.deploySuccess]: EvtDeploySuccessSchema,
  [SUBJECTS.evt.deployFailure]: EvtDeployFailureSchema,
  [SUBJECTS.evt.deployProgress]: EvtDeployProgressSchema,
  [SUBJECTS.evt.rollbackSuccess]: EvtRollbackSuccessSchema,
  [SUBJECTS.evt.rollbackFailure]: EvtRollbackFailureSchema,
  [SUBJECTS.evt.rollbackProgress]: EvtRollbackProgressSchema,
  [SUBJECTS.evt.resumeSuccess]: EvtResumeSuccessSchema,
  [SUBJECTS.evt.resumeFailure]: EvtResumeFailureSchema,
  [SUBJECTS.cmd.nginxClaim]: CmdNginxClaimSchema,
  [SUBJECTS.cmd.nginxRelease]: CmdNginxReleaseSchema,
  [SUBJECTS.cmd.cloudflareDomainAdd]: CmdCloudflareDomainAddSchema,
  [SUBJECTS.cmd.cloudflareDomainRemove]: CmdCloudflareDomainRemoveSchema,
  [SUBJECTS.evt.nginxReady]: EvtNginxReadySchema,
  [SUBJECTS.evt.nginxReleased]: EvtNginxReleasedSchema,
  [SUBJECTS.evt.nginxFailed]: EvtNginxFailedSchema,
  [SUBJECTS.evt.nginxProgress]: EvtNginxProgressSchema,
  [SUBJECTS.evt.cloudflareDomainReady]: EvtCloudflareDomainReadySchema,
  [SUBJECTS.evt.cloudflareDomainRemoved]: EvtCloudflareDomainRemovedSchema,
  [SUBJECTS.evt.cloudflareDomainFailed]: EvtCloudflareDomainFailedSchema,
  [SUBJECTS.evt.cloudflareDomainProgress]: EvtCloudflareDomainProgressSchema,
} as const satisfies Record<string, z.ZodTypeAny>
