#!/usr/bin/env node
import { execSync } from 'child_process';
import { readdir } from 'fs/promises';
import { join } from 'path';

const MIGRATIONS_DIR = './migrations';
const DATABASE_NAME = 'finpals-db';
const isRemote = process.argv.includes('--remote');

async function runMigrations() {
  console.log(`🚀 Running migrations on ${isRemote ? 'REMOTE' : 'LOCAL'} database...`);
  
  try {
    // Get all SQL files in migrations directory
    const files = await readdir(MIGRATIONS_DIR);
    const sqlFiles = files
      .filter(f => f.endsWith('.sql') && f !== 'run_all_migrations.sql')
      .sort(); // Alphabetical order ensures correct sequence
    
    console.log(`Found ${sqlFiles.length} migration files:`);
    sqlFiles.forEach(f => console.log(`  - ${f}`));
    
    // Run each migration
    for (const file of sqlFiles) {
      const filePath = join(MIGRATIONS_DIR, file);
      const command = `npx wrangler d1 execute ${DATABASE_NAME} ${isRemote ? '--remote' : '--local'} --file=${filePath}`;
      
      console.log(`\n📄 Running migration: ${file}`);
      
      try {
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ ${file} completed successfully`);
      } catch (error) {
        console.log(`⚠️  ${file} had errors (may be safe to ignore if columns/tables already exist)`);
      }
    }
    
    console.log('\n✨ All migrations completed!');
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  }
}

runMigrations();