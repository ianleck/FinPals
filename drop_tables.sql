-- Drop all tables in the correct order (to handle foreign key constraints)
DROP TABLE IF EXISTS expense_splits;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS recurring_expenses;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS expense_templates;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS category_mappings;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS users;