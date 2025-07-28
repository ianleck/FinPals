-- Add recurring expenses table
CREATE TABLE IF NOT EXISTS recurring_expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT, -- NULL for personal recurring expenses
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    description TEXT,
    category TEXT,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
    day_of_month INTEGER, -- For monthly expenses (1-31)
    day_of_week INTEGER, -- For weekly expenses (0-6, 0=Sunday)
    participants TEXT, -- JSON array of user IDs or 'all'
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_created DATETIME, -- Last time this recurring expense was created
    next_due DATETIME NOT NULL, -- Next time this expense should be created
    active BOOLEAN DEFAULT TRUE,
    is_personal BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (created_by) REFERENCES users(telegram_id)
);

-- Index for finding due recurring expenses
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_due ON recurring_expenses(next_due, active);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_group ON recurring_expenses(group_id, active);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_user ON recurring_expenses(created_by, is_personal, active);

-- Add recurring_expense_id to expenses table to track which expenses were created from recurring
ALTER TABLE expenses ADD COLUMN recurring_expense_id TEXT REFERENCES recurring_expenses(id);