import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle database instance using Hyperdrive connection
 */
export function createDb(env: { HYPERDRIVE: { connectionString: string } }) {
  const sql = postgres(env.HYPERDRIVE.connectionString, { 
    prepare: false, // Required for Cloudflare Workers edge runtime
    ssl: 'require', // CockroachDB requires SSL
    connection: {
      application_name: 'finpals-telegram'
    }
  });
  
  return drizzle(sql, { schema });
}

/**
 * Retry wrapper for handling CockroachDB serialization errors
 * CockroachDB uses SERIALIZABLE isolation by default which can cause
 * retry errors (40001) during concurrent operations
 */
export async function withRetry<T>(
  fn: () => Promise<T>, 
  maxRetries = 3,
  initialDelay = 100
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check for CockroachDB serialization error
      if (error.code === '40001' && i < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = initialDelay * Math.pow(2, i) + Math.random() * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // For other errors or final retry, throw immediately
      throw error;
    }
  }
  
  // If we've exhausted all retries
  throw new Error(`Transaction failed after ${maxRetries} retries: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Helper to format decimal values from the database
 * Drizzle returns decimals as strings to preserve precision
 */
export function parseDecimal(value: string | null | undefined): number {
  if (!value) return 0;
  return parseFloat(value);
}

/**
 * Helper to format amounts for database storage
 * Ensures consistent decimal precision
 */
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

// Export schema types for use in other files
export * from './schema';