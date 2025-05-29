import { D1Database } from '@cloudflare/workers-types';

export async function initializeDatabase(db: D1Database): Promise<void> {
  try {
    // Check if tables exist by querying sqlite_master
    const tables = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all();
    
    const tableNames = tables.results.map(t => t.name);
    
    // If core tables don't exist, the database needs initialization
    if (!tableNames.includes('users') || !tableNames.includes('expenses')) {
      console.log('Database not initialized. Please run schema.sql through Cloudflare Dashboard.');
      // Don't create tables programmatically as it's better to use the dashboard
      // for initial setup to avoid any permission issues
    }
  } catch (error) {
    console.error('Database initialization check failed:', error);
  }
}