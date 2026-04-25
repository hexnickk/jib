import { JibError } from '@jib/errors'

export class SystemdServiceStartError extends JibError {
  constructor(service: string, detail: string) {
    super('systemd_service_start_failed', `start ${service}: ${detail}`)
    this.name = 'SystemdServiceStartError'
  }
}
