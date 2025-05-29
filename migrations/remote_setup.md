# Remote Database Setup Options

If you encounter authorization errors with the remote database, here are alternative approaches:

## Option 1: Use Cloudflare Dashboard

1. Go to your Cloudflare dashboard
2. Navigate to Workers & Pages > D1
3. Select your `finpals-db` database
4. Use the "Console" tab to execute SQL directly
5. Copy and paste the contents of `complete_schema.sql`

## Option 2: Split the Migration

If the file is too large, create smaller migration files:

```bash
# Create individual table files
npx wrangler d1 execute finpals-db --remote --command="DROP TABLE IF EXISTS expense_splits"
npx wrangler d1 execute finpals-db --remote --command="DROP TABLE IF EXISTS expenses"
# ... continue for each table

# Then create tables one by one
npx wrangler d1 execute finpals-db --remote --command="CREATE TABLE users (...)"
# ... continue for each table
```

## Option 3: Use API Token Instead of OAuth

1. Create an API token at https://dash.cloudflare.com/profile/api-tokens
2. Grant it "D1:Edit" permissions
3. Configure wrangler:
   ```bash
   export CLOUDFLARE_API_TOKEN=your_token_here
   npx wrangler d1 execute finpals-db --remote --file=./migrations/complete_schema.sql
   ```

## Option 4: Direct SQL Commands

Execute the migration as individual commands:

```bash
# Drop tables
npx wrangler d1 execute finpals-db --remote --command="DROP TABLE IF EXISTS expense_splits"

# Create users table
npx wrangler d1 execute finpals-db --remote --command="CREATE TABLE users (telegram_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"

# Continue with other tables...
```

## Recommended Approach

Since you're doing a clean setup with few users:

1. First, try the Cloudflare Dashboard method (Option 1) - it's the most reliable
2. If that's not convenient, use Option 3 with an API token
3. As a last resort, split the migration into smaller commands (Option 4)