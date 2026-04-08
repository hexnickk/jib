import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './libs/state/tables.ts',
  out: './libs/state/drizzle',
  dialect: 'sqlite',
})
