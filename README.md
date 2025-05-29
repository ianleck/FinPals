# FinPals Setup Guide

## Prerequisites

1. **Telegram Bot Token**
   - Create a bot via [@BotFather](https://t.me/botfather)
   - Save the bot token

2. **Cloudflare Account**
   - Sign up at [cloudflare.com](https://cloudflare.com)
   - Note your account ID

## Installation

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd FinPals
   npm install
   ```

2. **Configure Environment**
   - Copy `.dev.vars.example` to `.dev.vars`
   - Update with your bot token

3. **Database Setup**
   ```bash
   # Create local database
   npx wrangler d1 create finpals-db
   
   # Run schema
   npx wrangler d1 execute finpals-db --local --file=./schema.sql
   
   # Run migrations
   npx wrangler d1 execute finpals-db --local --file=./migrations/add_trips.sql
   ```

## Bot Configuration

### 1. Set Webhook
After deployment, set the webhook:
```bash
curl -F "url=https://your-worker.workers.dev/" \
     https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
```

### 2. Register Commands
Visit your worker URL to register commands:
```
https://your-worker.workers.dev/api/set-commands
```

This will enable command auto-completion when users type `/` in Telegram.

### 3. Bot Permissions (IMPORTANT!)
For the bot to work properly in groups, it needs admin permissions:

1. Add the bot to your group
2. Go to Group Info → Administrators
3. Add your bot as administrator
4. Enable these permissions:
   - ✅ **Delete messages** (Required for message cleanup)
   - ✅ **Pin messages** (Optional)
   - ✅ **Restrict members** (Optional)

Without "Delete messages" permission, the bot cannot clean up command messages.

## Development

1. **Start Local Development**
   ```bash
   npm run dev
   ```

2. **Test Bot Permissions**
   Use `/test` command in a group to verify bot permissions

3. **Deploy to Production**
   ```bash
   npm run deploy
   ```

## Features

### Message Cleanup
- User command messages are deleted automatically (requires bot admin rights)
- Bot messages remain visible (due to Cloudflare Workers stateless nature)
- Works only in groups, not in private chats

### Trip Management
- Start trips with `/trip start <name>`
- All expenses are linked to active trip
- End trips to see summary

### Command List
- `/add [amount] [description] [@mentions]` - Add expense
- `/balance` - Show who owes whom
- `/settle @user [amount]` - Record payment
- `/expenses` - Browse all expenses
- `/trip` - Manage trips
- `/help` - Show all commands

## Troubleshooting

### Bot Not Responding
1. Check webhook is set correctly
2. Verify bot token in wrangler.toml
3. Check logs: `npx wrangler tail`

### Messages Not Deleting
1. Run `/test` to check bot permissions
2. Ensure bot is admin with "Delete messages" permission
3. Check console logs for deletion errors

### Commands Not Showing
1. Visit `/api/set-commands` endpoint
2. Wait a few minutes for Telegram to update
3. Restart Telegram app if needed

## Production Deployment

1. **Create Production Database**
   ```bash
   npx wrangler d1 create finpals-db-prod
   ```

2. **Update wrangler.toml**
   Add the database_id to production section

3. **Run Production Schema**
   ```bash
   npx wrangler d1 execute finpals-db-prod --remote --file=./schema.sql
   npx wrangler d1 execute finpals-db-prod --remote --file=./migrations/add_trips.sql
   ```

4. **Deploy**
   ```bash
   npm run deploy --env production
   ```

## Support

For issues or questions:
- Check logs: `npx wrangler tail`
- Debug with `/test` command
- Review error messages in console