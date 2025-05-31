-- Add expense templates table for quick expense creation
CREATE TABLE IF NOT EXISTS expense_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    group_id TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT,
    participants TEXT, -- JSON array of user IDs
    shortcut TEXT UNIQUE,
    preferred_time TEXT, -- HH:MM format for time-based suggestions
    usage_count INTEGER DEFAULT 0,
    last_used DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id),
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id)
);

-- Index for quick lookups
CREATE INDEX idx_templates_user ON expense_templates(user_id, deleted);
CREATE INDEX idx_templates_shortcut ON expense_templates(shortcut) WHERE deleted = FALSE;
CREATE INDEX idx_templates_usage ON expense_templates(usage_count DESC, last_used DESC);

-- Add template_id to expenses for tracking
ALTER TABLE expenses ADD COLUMN template_id TEXT REFERENCES expense_templates(id);