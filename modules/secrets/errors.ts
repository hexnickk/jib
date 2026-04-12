import { JibError } from '@jib/errors'

export class SecretsReadError extends JibError {
  constructor(path: string, options?: ErrorOptions) {
    super('secrets.read', `reading secrets ${path}`, options)
  }
}

export class SecretsWriteError extends JibError {
  constructor(path: string, options?: ErrorOptions) {
    super('secrets.write', `writing secrets ${path}`, options)
  }
}

export class SecretsStatError extends JibError {
  constructor(path: string, options?: ErrorOptions) {
    super('secrets.stat', `checking secrets ${path}`, options)
  }
}

export class SecretsRemoveAppError extends JibError {
  constructor(path: string, options?: ErrorOptions) {
    super('secrets.remove_app', `removing secrets ${path}`, options)
  }
}
