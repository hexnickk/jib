import { defaultIngressBackend } from './backends/index.ts'

const backend = defaultIngressBackend()

const manifest = {
  name: 'ingress',
  required: true,
  description: `Ingress reverse proxy (${backend.name} backend)`,
} satisfies { name: string; required?: boolean; description?: string }

export default manifest
