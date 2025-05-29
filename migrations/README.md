# FinPals Database Migrations

## Simplified Migration Strategy

Since there aren't many users yet, we've consolidated all migrations into a single clean schema.

### For Fresh Setup

Use the main schema file to set up a fresh database:

```bash
# Fresh local setup
npx wrangler d1 execute finpals-db --local --file=./schema.sql

# Fresh remote setup
npx wrangler d1 execute finpals-db --remote --file=./schema.sql
```

### For Clean Reinstall (drops all data)

```bash
# Local clean reinstall
npx wrangler d1 execute finpals-db --local --file=./migrations/complete_schema.sql

# Remote clean reinstall
npx wrangler d1 execute finpals-db --remote --file=./migrations/complete_schema.sql
```

## Schema Features

The complete schema includes:

1. **Core Tables**
   - `users` - Telegram users with preferences
   - `groups` - Telegram groups
   - `group_members` - User-group relationships
   - `expenses` - Both group and personal expenses (group_id is nullable)
   - `expense_splits` - How group expenses are divided
   - `settlements` - Payments between users
   - `trips` - Trip-based expense grouping
   - `budgets` - Personal budget limits by category
   - `category_mappings` - Smart categorization
   - `user_preferences` - User notification settings

2. **Key Features**
   - Personal expense tracking (is_personal = TRUE, group_id = NULL)
   - Group expense splitting
   - Trip management
   - Budget tracking with daily/weekly/monthly periods
   - Smart categorization with confidence scores
   - Full performance optimization indexes

3. **Performance Indexes**
   - 17 indexes for optimal query performance
   - Composite indexes for complex queries
   - Specialized indexes for budget calculations
   - Category lookup optimizations

## Legacy Migration Files

The individual migration files in this directory are kept for reference but are no longer needed:
- `add_trips.sql` - Trip functionality (included in main schema)
- `add_indexes.sql` - Basic indexes (included in main schema)
- `add_budgets.sql` - Budget tables (included in main schema)
- `add_personal_expenses.sql` - Personal expense support (included in main schema)
- `add_performance_indexes.sql` - Performance optimizations (included in main schema)
- `safe_run_all.sql` - Partial migrations (replaced by complete_schema.sql)

The complete schema in `schema.sql` includes all features and optimizations.