-- Fresh schema with proper NULL support for personal expenses

-- Users table
CREATE TABLE users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    timezone TEXT DEFAULT 'UTC',
    preferred_currency TEXT DEFAULT 'USD',
    premium_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Groups table
CREATE TABLE groups (
    telegram_id TEXT PRIMARY KEY,
    title TEXT,
    default_currency TEXT DEFAULT 'USD',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
);

-- Group members junction table
CREATE TABLE group_members (
    group_id TEXT,
    user_id TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Trips table
CREATE TABLE trips (
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

-- Expenses table with nullable group_id
CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT, -- NULL for personal expenses
    trip_id TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    description TEXT,
    category TEXT,
    paid_by TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,
    is_personal BOOLEAN DEFAULT FALSE, -- TRUE for personal expenses
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (trip_id) REFERENCES trips(id),
    FOREIGN KEY (paid_by) REFERENCES users(telegram_id),
    FOREIGN KEY (created_by) REFERENCES users(telegram_id)
);

-- Expense participants
CREATE TABLE expense_splits (
    expense_id TEXT,
    user_id TEXT,
    amount REAL NOT NULL,
    PRIMARY KEY (expense_id, user_id),
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Settlements
CREATE TABLE settlements (
    id TEXT PRIMARY KEY,
    group_id TEXT, -- NULL for personal settlements
    trip_id TEXT,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_personal BOOLEAN DEFAULT FALSE, -- TRUE for personal settlements
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (trip_id) REFERENCES trips(id),
    FOREIGN KEY (from_user) REFERENCES users(telegram_id),
    FOREIGN KEY (to_user) REFERENCES users(telegram_id)
);

-- User preferences
CREATE TABLE user_preferences (
    user_id TEXT PRIMARY KEY,
    notifications BOOLEAN DEFAULT TRUE,
    weekly_summary BOOLEAN DEFAULT TRUE,
    auto_remind BOOLEAN DEFAULT FALSE,
    reminder_days INTEGER DEFAULT 7,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Categories for AI training
CREATE TABLE category_mappings (
    description_pattern TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    usage_count INTEGER DEFAULT 1
);

-- Budgets table for personal expense tracking
CREATE TABLE budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id),
    UNIQUE(user_id, category)
);

-- Basic operation indexes
CREATE INDEX idx_expenses_group ON expenses(group_id, deleted);
CREATE INDEX idx_expenses_paid_by ON expenses(paid_by);
CREATE INDEX idx_expenses_personal ON expenses(paid_by, is_personal, deleted);
CREATE INDEX idx_expense_splits_user ON expense_splits(user_id);
CREATE INDEX idx_settlements_group ON settlements(group_id);
CREATE INDEX idx_settlements_users ON settlements(from_user, to_user);
CREATE INDEX idx_group_members_group ON group_members(group_id, active);
CREATE INDEX idx_trips_group ON trips(group_id, status);
CREATE INDEX idx_budgets_user ON budgets(user_id);

-- Performance optimization indexes
CREATE INDEX idx_expenses_user_personal ON expenses(paid_by, is_personal, deleted, created_at);
CREATE INDEX idx_expenses_group_date ON expenses(group_id, created_at, deleted);
CREATE INDEX idx_expenses_category_lookup ON expenses(paid_by, category, deleted);
CREATE INDEX idx_expense_splits_composite ON expense_splits(user_id, expense_id);
CREATE INDEX idx_expenses_budget_query ON expenses(category, is_personal, deleted, created_at);
CREATE INDEX idx_settlements_date ON settlements(created_at);
CREATE INDEX idx_expenses_trip ON expenses(trip_id, deleted);
CREATE INDEX idx_category_mappings_confidence ON category_mappings(confidence DESC, usage_count DESC);