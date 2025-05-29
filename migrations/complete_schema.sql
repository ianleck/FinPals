-- Complete FinPals Database Schema
-- This creates all tables, indexes, and constraints in one clean migration

-- Drop existing tables (in correct order due to foreign keys)
DROP TABLE IF EXISTS expense_splits;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS category_mappings;

-- Create users table
CREATE TABLE users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create groups table
CREATE TABLE groups (
    telegram_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create group_members table
CREATE TABLE group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Create trips table
CREATE TABLE trips (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (created_by) REFERENCES users(telegram_id)
);

-- Create expenses table with nullable group_id for personal expenses
CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT,  -- NULL for personal expenses
    trip_id TEXT,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    category TEXT,
    paid_by TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,
    is_personal BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (trip_id) REFERENCES trips(id),
    FOREIGN KEY (paid_by) REFERENCES users(telegram_id),
    FOREIGN KEY (created_by) REFERENCES users(telegram_id)
);

-- Create expense_splits table
CREATE TABLE expense_splits (
    expense_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (expense_id, user_id),
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Create settlements table
CREATE TABLE settlements (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (from_user) REFERENCES users(telegram_id),
    FOREIGN KEY (to_user) REFERENCES users(telegram_id)
);

-- Create budgets table
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

-- Create category_mappings table
CREATE TABLE category_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_text TEXT NOT NULL,
    mapped_category TEXT NOT NULL,
    confidence REAL DEFAULT 0.8,
    usage_count INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(original_text)
);

-- Create all performance indexes

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