import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Use the connection string directly for CockroachDB
    url: 'postgresql://ian:6uRZPqtgOs5O2tnBnbjzjA@finpals-8841.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=require',
  },
  verbose: true,
  strict: true,
} satisfies Config;