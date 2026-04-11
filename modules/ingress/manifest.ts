import type { ModuleManifest } from '@jib/core'
import { defaultIngressBackend } from './backends/index.ts'

const backend = defaultIngressBackend()

const manifest: ModuleManifest = {
  name: 'ingress',
  required: true,
  description: `Ingress reverse proxy (${backend.name} backend)`,
}

export default manifest
