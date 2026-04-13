import { JibError } from '@jib/errors'

export class IngressMissingPortError extends JibError {
  constructor(app: string, host: string) {
    super('ingress.missing_port', `ingress port missing for app "${app}" domain "${host}"`)
  }
}

export class NginxIngressReloadError extends JibError {
  constructor(message: string) {
    super('ingress.nginx_reload', message)
  }
}
