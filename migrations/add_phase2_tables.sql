-- Phase 2 Tables Migration
-- Add tables for recurring reminders and budget alerts

-- Table for tracking sent recurring reminders
CREATE TABLE IF NOT EXISTS recurring_reminders (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    description TEXT NOT NULL,
    pattern_frequency TEXT NOT NULL,
    reminder_sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_expected DATE,
    UNIQUE(group_id, user_id, description, next_expected)
);

-- Index for efficient reminder queries
CREATE INDEX IF NOT EXISTS idx_recurring_reminders_lookup 
ON recurring_reminders(group_id, user_id, next_expected);

-- Table for tracking sent budget alerts
CREATE TABLE IF NOT EXISTS budget_alerts_sent (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    alert_level INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    period_start DATE NOT NULL,
    UNIQUE(user_id, category, alert_level, period_start)
);

-- Index for efficient alert queries
CREATE INDEX IF NOT EXISTS idx_budget_alerts_lookup 
ON budget_alerts_sent(user_id, period_start);