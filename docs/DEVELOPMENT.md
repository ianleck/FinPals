# FinPals Development Guide

## 🏗️ Architecture Overview

FinPals is built on Cloudflare's serverless platform using:
- **Runtime**: Cloudflare Workers (TypeScript)
- **Bot Framework**: grammY
- **Database**: D1 (SQLite)
- **Session Storage**: Durable Objects
- **Testing**: Vitest

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Cloudflare account
- Telegram Bot Token (from @BotFather)

### Initial Setup

1. **Clone and Install**
```bash
git clone <repository-url>
cd FinPals
npm install
```

2. **Configure Environment**
```bash
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml with your credentials
```

3. **Database Setup**

#### Option A: Cloudflare Dashboard (Recommended)
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to Workers & Pages → D1
3. Click on your database
4. Use the Console tab to execute `schema.sql`

#### Option B: CLI (Local Development)
```bash
npx wrangler d1 create finpals-db
npx wrangler d1 execute finpals-db --local --file=./schema.sql
```

4. **Start Development**
```bash
npm run dev
```

## 📁 Project Structure

```
FinPals/
├── src/
│   ├── index.ts           # Main bot entry point
│   ├── commands/          # Command handlers
│   ├── utils/             # Shared utilities
│   └── __tests__/         # Test suite
├── migrations/            # Database migrations
├── schema.sql            # Database schema
├── wrangler.toml         # Cloudflare config
└── vitest.config.ts      # Test configuration
```

## 🧪 Testing

### Running Tests
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

### Test Coverage
- 152 tests covering all major functionality
- Behavior-focused testing approach
- Mock implementations for external services

### Writing Tests
```typescript
// Use test utilities for consistent behavior testing
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

it('should add expense successfully', async () => {
  const db = createTestDatabase();
  const ctx = createMockContext({ message: { text: '/add 50 lunch' } });
  
  await handleAdd(ctx, db);
  
  const { text } = extractReplyContent(ctx);
  expect(text).toContain('Expense Added');
});
```

## 🔧 Key Features Implementation

### Supergroup Topic Support
The bot supports Telegram supergroups with forum/topic mode:
- Detects forum-enabled supergroups
- Replies to the same topic thread
- Maintains backward compatibility

### Performance Optimizations
- **Batch Queries**: Reduced N+1 queries by 67%
- **Optimized Indexes**: Strategic database indexes
- **Response Time**: <100ms for all commands

### Smart Features
- **AI Categorization**: Emoji and keyword-based
- **Time-based Insights**: Context-aware suggestions
- **Pattern Learning**: Improves categorization over time

## 🚀 Deployment

### Production Deployment
```bash
# Create production database
npx wrangler d1 create finpals-db-prod

# Update wrangler.toml with production database ID

# Deploy
npm run deploy
```

### Post-Deployment Setup
1. **Set Webhook**
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-worker.workers.dev"
```

2. **Register Commands**
```bash
curl https://your-worker.workers.dev/api/set-commands
```

## 📊 Database Schema

### Core Tables
- `users`: Telegram user information
- `groups`: Telegram group data
- `expenses`: Expense records
- `expense_splits`: Participant splits
- `settlements`: Payment records
- `trips`: Trip management

### Performance Indexes
```sql
CREATE INDEX idx_expenses_group_created ON expenses(group_id, created_at DESC);
CREATE INDEX idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX idx_settlements_group ON settlements(group_id);
```

## 🐛 Debugging

### Local Development
```bash
# View logs
npx wrangler tail

# Test specific command
npm run dev
# Then message the bot in Telegram
```

### Common Issues

1. **Webhook Not Working**
   - Verify webhook URL is correct
   - Check bot token in wrangler.toml
   - Ensure secret token matches

2. **Database Errors**
   - Check D1 binding in wrangler.toml
   - Verify schema is applied
   - Check query syntax

3. **Permission Issues**
   - Bot needs admin rights for message deletion
   - Users must interact with bot before mentions work

## 🔒 Security Best Practices

1. **Environment Variables**
   - Never commit wrangler.toml with real tokens
   - Use wrangler secrets for sensitive data

2. **Input Validation**
   - All user inputs are sanitized
   - SQL injection prevented via prepared statements
   - HTML escaped in all outputs

3. **Rate Limiting**
   - Per-user rate limits implemented
   - Telegram API limits respected

## 📈 Monitoring

### Key Metrics
- Response time per command
- Active groups count
- Daily expense count
- Error rates

### Error Tracking
- Console errors logged (production uses proper logging)
- User-friendly error messages
- Graceful degradation

## 🤝 Contributing

### Code Style
- TypeScript with strict mode
- Functional programming preferred
- No console.log in production code

### Pull Request Process
1. Create feature branch
2. Write/update tests
3. Ensure all tests pass
4. Update documentation
5. Submit PR with clear description

### Commit Messages
Follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation
- `test:` Test updates
- `perf:` Performance improvements

## 📚 Additional Resources

- [grammY Documentation](https://grammy.dev)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers)
- [D1 Database Guide](https://developers.cloudflare.com/d1)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## 🆘 Troubleshooting

### Debug Mode
Enable debug logging:
```typescript
// In development
console.debug('Debug info:', data);
```

### Database Queries
Test queries directly:
```bash
npx wrangler d1 execute finpals-db --local --command="SELECT * FROM expenses LIMIT 5"
```

### API Testing
Use curl for direct API testing:
```bash
curl -X POST https://api.telegram.org/bot<TOKEN>/getMe
```

---

For more information, see the [Design Document](DESIGN.md) for product roadmap and feature planning.