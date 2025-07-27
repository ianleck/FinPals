# FinPals Development Guide

## 🏗️ Architecture Overview

FinPals is built on modern serverless architecture:

- **Runtime**: Cloudflare Workers (V8 isolates)
- **Database**: D1 (SQLite at the edge)
- **Session Storage**: Durable Objects
- **Language**: TypeScript
- **Bot Framework**: grammY
- **AI Services**: Cloudflare AI (Whisper, LLaVA)
- **Testing**: Vitest with Miniflare

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account (free tier works)
- Telegram Bot Token from [@BotFather](https://t.me/botfather)

### Initial Setup

1. **Clone and Install**
   ```bash
   git clone https://github.com/yourusername/finpals
   cd finpals
   npm install
   ```

2. **Configure Wrangler**
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```
   
   Edit `wrangler.toml`:
   - Set your `account_id` (find in Cloudflare dashboard)
   - Update database IDs after creation (see below)

3. **Create Database**
   ```bash
   # Create local database
   npx wrangler d1 create finpals-db --local
   
   # Create production database
   npx wrangler d1 create finpals-db-prod
   ```
   
   Copy the database ID from the output to `wrangler.toml`.

4. **Run Migrations**
   ```bash
   # Local database
   npx wrangler d1 execute finpals-db --local --file=./schema.sql
   
   # Production database
   npx wrangler d1 execute finpals-db-prod --remote --file=./schema.sql
   ```
   
   **Note**: If you encounter authorization errors with remote database:
   - Use Cloudflare Dashboard → D1 → Console to execute SQL
   - Or create an API token with D1:Edit permissions
   - See Database Schema section below for details

5. **Set Secrets**
   ```bash
   # For local development, add to wrangler.toml [vars] section
   # For production, use secrets:
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put TELEGRAM_BOT_API_SECRET_TOKEN
   ```

6. **Start Development**
   ```bash
   npm run dev
   ```

### Setting up Telegram Webhook

1. **Deploy to Cloudflare**
   ```bash
   npm run deploy
   ```

2. **Set Webhook**
   ```bash
   curl -X POST https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://your-worker.workers.dev",
       "secret_token": "YOUR_SECRET_TOKEN"
     }'
   ```

3. **Register Commands**
   ```bash
   curl https://your-worker.workers.dev/api/set-commands
   ```

## 📁 Project Structure

```
finpals/
├── src/
│   ├── index.ts              # Main entry point & webhook handler
│   ├── SessionDO.ts          # Durable Object for sessions
│   ├── commands/             # Command handlers
│   │   ├── add-enhanced.ts   # Smart expense addition
│   │   ├── balance.ts        # Balance calculations
│   │   └── ...
│   └── utils/               # Utility functions
│       ├── database.ts      # Database helpers
│       ├── currency.ts      # Currency conversion
│       ├── validation.ts    # Input validation
│       └── ...
├── migrations/              # Database migrations
├── docs/                    # Documentation
└── __tests__/              # Test files
```

## 🧪 Testing

### Test Structure

```
__tests__/
├── commands/          # Unit tests for commands
├── utils/            # Unit tests for utilities
├── integration/      # Integration tests
├── mocks/           # Mock utilities
└── helpers/         # Test helpers
```

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Run specific test
npm test balance.test.ts

# Coverage report
npm test -- --coverage

# Run tests matching pattern
npm test -- --grep "personal"
```

### Writing Tests

Example test structure:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockContext } from '../mocks/context';
import { createTestDatabase } from '../helpers/test-utils';

describe('Command Name', () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDatabase();
    vi.clearAllMocks();
  });

  it('should handle basic functionality', async () => {
    // Arrange
    const ctx = createMockContext({
      message: { text: '/command args' }
    });

    // Act
    await handleCommand(ctx, db);

    // Assert
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('expected response')
    );
  });

  it('should handle errors gracefully', async () => {
    const ctx = createMockContext({
      message: { text: '/command invalid' }
    });

    await handleCommand(ctx, db);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('error message')
    );
  });
});
```

### Mock Utilities

- **`createMockContext()`** - Creates group chat context
- **`createPrivateContext()`** - Creates private chat context  
- **`createTestDatabase()`** - Creates mock D1 database
- **`extractReplyContent()`** - Extracts reply text and buttons

### Test Coverage

Current coverage: ~44% of commands

**Well-tested areas:**
- Core commands (add, balance, settle)
- Budget management
- Personal expenses
- Trip management
- Input validation
- Currency handling

**Areas needing tests:**
- Export functionality
- Category management
- Statistics generation
- Error recovery flows

## 🚀 Deployment

### Production Checklist

1. **Security**
   - [ ] Move secrets from wrangler.toml to environment
   - [ ] Verify webhook secret token is set
   - [ ] Check database permissions

2. **Database**
   - [ ] Run all migrations
   - [ ] Create necessary indexes
   - [ ] Test with production data volume

3. **Monitoring**
   - [ ] Enable Cloudflare Analytics
   - [ ] Set up error alerts
   - [ ] Configure wrangler tail for logs

### Deploy Commands

```bash
# Deploy to production
npm run deploy

# Deploy to staging environment
npx wrangler deploy --env staging

# View logs
npx wrangler tail

# Run migrations on production
node run-migrations.js
```

## 🔧 Common Development Tasks

### Adding a New Command

1. Create handler in `src/commands/`:
   ```typescript
   export async function handleNewCommand(ctx: Context, db: D1Database) {
     // Implementation
   }
   ```

2. Register in `src/index.ts`:
   ```typescript
   bot.command('newcommand', (ctx) => handleNewCommand(ctx, env.DB));
   ```

3. Add to command list in `handleHelp()` and constants

4. Write tests in `__tests__/commands/`

### Database Schema

The complete schema is in `schema.sql` and includes:
- Core tables (users, groups, expenses, settlements)
- Personal expense support (nullable group_id)
- Trip management
- Budget tracking with periods
- Smart categorization
- Performance indexes

For schema changes:
1. Update `schema.sql` with new tables/columns
2. Create a migration file in `migrations/` for existing databases
3. Test locally first
4. Apply to production after verification

### Adding AI Features

The AI binding is configured in `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

Use in code:
```typescript
const result = await env.AI.run('@cf/openai/whisper', {
  audio: audioData,
});
```

## 🐛 Debugging

### Local Development

1. **Check logs**: Terminal output from `npm run dev`
2. **Database queries**: Add console.log in database.ts
3. **Use test command**: `/test` in groups

### Production

1. **View logs**: `npx wrangler tail`
2. **Check metrics**: Cloudflare dashboard
3. **Database state**: Use D1 console in dashboard

## 📈 Performance Optimization

### Database

- Use prepared statements
- Batch queries when possible
- Add indexes for frequent queries
- Avoid N+1 queries

### Worker Limits

- 128MB memory limit
- 10ms CPU time (50ms for paid plans)
- 1MB request/response size
- Keep responses under 25 messages/second

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch: `git checkout -b feature/amazing`
3. **Test** thoroughly with `npm test`
4. **Commit** with clear messages
5. **Push** and create Pull Request

### Code Style

- Use TypeScript strict mode
- Follow existing patterns
- Add JSDoc comments for public functions
- Keep functions small and focused

### PR Guidelines

- Include tests for new features
- Update documentation
- Ensure all tests pass
- Keep commits atomic

## 📚 Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Database Docs](https://developers.cloudflare.com/d1/)
- [grammY Documentation](https://grammy.dev/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## 🔒 Security Notes

- Never commit tokens or secrets
- Validate all user input
- Use prepared statements for queries
- Implement rate limiting
- Escape HTML in responses

---

For user documentation, see [README.md](README.md)  
For troubleshooting, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)