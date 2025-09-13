import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables from .dev.vars for local development
// Wrangler doesn't automatically load .dev.vars for non-wrangler commands
if (fs.existsSync('.dev.vars')) {
  const devVars = fs.readFileSync('.dev.vars', 'utf-8');
  devVars.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Use DATABASE_URL from .dev.vars for migrations
    // In production, this would come from CI/CD environment
    url: process.env.DATABASE_URL || process.env.HYPERDRIVE_LOCAL_CONNECTION_STRING || '',
  },
  verbose: true,
  strict: true,
} satisfies Config;