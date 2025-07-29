-- Add trip support to existing database
-- This migration adds trip_id columns without dropping existing data

-- Create trips table if it doesn't exist
CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_date DATETIME,
    created_by TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (created_by) REFERENCES users(telegram_id)
);

-- Add trip_id column to expenses if it doesn't exist
-- Note: SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS
-- So we need to handle this carefully in production

-- For new installations, these columns are already in schema.sql
-- For existing installations, you may need to:
-- 1. Create a new table with the correct schema
-- 2. Copy data from old table
-- 3. Drop old table
-- 4. Rename new table

-- Alternative approach: Check if column exists first in your deployment script
-- If not, then run:
-- ALTER TABLE expenses ADD COLUMN trip_id TEXT REFERENCES trips(id);
-- ALTER TABLE settlements ADD COLUMN trip_id TEXT REFERENCES trips(id);