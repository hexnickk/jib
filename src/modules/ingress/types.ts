export interface IngressDomain {
  host: string
  port: number
  isTunnel: boolean
}

export interface IngressClaim {
  app: string
  domains: IngressDomain[]
}

export interface IngressProgress {
  app: string
  message: string
}

export interface IngressOperator {
  claim(
    claim: IngressClaim,
    onProgress?: (progress: IngressProgress) => void,
  ): Promise<undefined | Error>
  release(app: string, onProgress?: (progress: IngressProgress) => void): Promise<undefined | Error>
}
