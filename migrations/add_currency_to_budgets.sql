-- Add currency field to budgets table
ALTER TABLE budgets ADD COLUMN currency TEXT DEFAULT 'USD';

-- Update existing budgets to use user's preferred currency
UPDATE budgets 
SET currency = COALESCE(
    (SELECT preferred_currency FROM users WHERE users.telegram_id = budgets.user_id),
    'USD'
);