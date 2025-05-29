# FinPals Database Setup Guide

## Cleanest Setup Method: Cloudflare Dashboard

### Step 1: Access D1 Console
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages** → **D1**
3. Click on your database: `finpals-db`
4. Click the **Console** tab

### Step 2: Apply Schema
1. Copy the entire contents of `schema.sql`
2. Paste into the SQL console
3. Click **Execute**

That's it! ✅

## Why This is the Cleanest Method

1. **No Authentication Issues** - Dashboard uses your web session
2. **Direct Execution** - No file upload/import complications  
3. **Immediate Feedback** - See results instantly
4. **Error Handling** - Clear error messages if something goes wrong
5. **No CLI Complexity** - Just copy, paste, execute

## Alternative: Command-by-Command

If the full schema fails, you can execute it in chunks:

1. First, create core tables (users, groups)
2. Then create dependent tables (expenses, settlements)
3. Finally, create indexes

But usually, the full schema executes without issues.

## Verify Setup

After execution, you can verify in the same console:

```sql
-- Check all tables were created
SELECT name FROM sqlite_master WHERE type='table';

-- Check indexes were created  
SELECT name FROM sqlite_master WHERE type='index';
```

## Local Development

For local development, wrangler works fine:

```bash
npx wrangler d1 execute finpals-db --local --file=./schema.sql
```

The authentication issues only affect remote execution through wrangler.