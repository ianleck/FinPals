-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_expenses_group_trip ON expenses(group_id, trip_id, deleted);
CREATE INDEX IF NOT EXISTS idx_expenses_created ON expenses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_group_trip ON settlements(group_id, trip_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_trips_group_status ON trips(group_id, status);