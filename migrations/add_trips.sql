-- Add trips table
CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active', -- active, ended
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (created_by) REFERENCES users(telegram_id)
);

-- Add trip_id to expenses table
ALTER TABLE expenses ADD COLUMN trip_id TEXT REFERENCES trips(id);

-- Add trip_id to settlements table  
ALTER TABLE settlements ADD COLUMN trip_id TEXT REFERENCES trips(id);