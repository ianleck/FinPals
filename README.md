# FinPals - Telegram Expense Tracking Bot

FinPals is a powerful Telegram bot for managing shared expenses and settlements within groups. Built on Cloudflare Workers for serverless deployment, it offers smart expense tracking, automatic categorization, and seamless group financial management.

## 🌟 Features

### Core Features
- **Smart Expense Tracking** - Add expenses with automatic categorization using AI
- **Flexible Splitting** - Equal splits or custom amounts per person
- **Real-time Balances** - See who owes whom at any time
- **Easy Settlements** - Record payments and track settlement history
- **Trip Management** - Organize expenses by trips or events
- **Personal Budgets** - Set and track budgets in private chat
- **Data Export** - Export expenses as CSV for external analysis

### Smart Features
- 🧠 **AI Categorization** - Automatically categorizes expenses based on description
- ⏰ **Time-based Insights** - Context-aware suggestions based on time of day
- 🎯 **Smart Suggestions** - Learns from your spending patterns
- 📊 **Visual Analytics** - Charts and insights about spending habits
- 🔔 **DM Notifications** - Get notified when added to expenses

## 🚀 Quick Start

### Prerequisites
1. **Telegram Bot Token** - Create via [@BotFather](https://t.me/botfather)
2. **Cloudflare Account** - Sign up at [cloudflare.com](https://cloudflare.com)
3. **Node.js 18+** - For local development

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd FinPals
   npm install
   ```

2. **Configure environment**
   ```bash
   # Copy the example configuration
   cp wrangler.toml.example wrangler.toml
   
   # Update wrangler.toml with your:
   # - Cloudflare account ID
   # - Telegram bot token
   # - Database IDs
   ```

3. **Setup database**
   ```bash
   # Create D1 database
   npx wrangler d1 create finpals-db
   
   # Run schema
   npx wrangler d1 execute finpals-db --local --file=./schema.sql
   ```

4. **Start development**
   ```bash
   npm run dev
   ```

## 📱 Bot Commands

### Group Commands
| Command | Description | Example |
|---------|-------------|---------|
| `/add` | Add expense | `/add 50 lunch @john @sarah` |
| `/balance` | View balances | `/balance` |
| `/settle` | Record payment | `/settle @john 25` |
| `/expenses` | Browse expenses | `/expenses` |
| `/trip` | Manage trips | `/trip start Bali 2024` |
| `/stats` | View statistics | `/stats` |
| `/export` | Export data | `/export` |

### Private Commands
| Command | Description | Example |
|---------|-------------|---------|
| `/budget` | Manage budgets | `/budget set "Food" 500 monthly` |
| `/personal` | Personal summary | `/personal` |
| `/add` | Personal expense | `/add 25 coffee` |

## ⚙️ Configuration

### Bot Permissions
For proper functionality, the bot needs admin permissions in groups:
- ✅ **Delete messages** - For cleaning up commands
- ✅ **Send messages** - Basic functionality
- ✅ **Read messages** - Process commands

### Webhook Setup
After deployment:
```bash
curl -F "url=https://your-worker.workers.dev/" \
     https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
```

### Command Registration
Visit to enable auto-completion:
```
https://your-worker.workers.dev/api/set-commands
```

## 🧪 Testing

Run the test suite:
```bash
npm test           # Run all tests
npm run test:watch # Watch mode
npm run coverage   # Coverage report
```

## 🚀 Deployment

### Production Deployment
```bash
# Create production database
npx wrangler d1 create finpals-db-prod

# Update wrangler.toml with the database ID

# Run migrations
npx wrangler d1 execute finpals-db-prod --remote --file=./schema.sql

# Deploy
npm run deploy
```

### Environment Variables
- `BOT_TOKEN` - Telegram bot token
- `TELEGRAM_BOT_API_SECRET_TOKEN` - Webhook security token
- `ENV` - Environment (development/production)

## 🏗️ Architecture

- **Runtime**: Cloudflare Workers (Serverless)
- **Database**: Cloudflare D1 (SQLite)
- **Session Storage**: Durable Objects
- **Language**: TypeScript
- **Bot Framework**: grammY
- **Testing**: Vitest

## 📈 Performance

Recent optimizations include:
- Batch database queries to eliminate N+1 problems
- Optimized expense split insertions
- Efficient user lookup queries
- Smart caching strategies

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Documentation**: Check `/docs` folder
- **Issues**: GitHub Issues
- **Logs**: `npx wrangler tail`
- **Debug**: Use `/test` command in groups

## 🔒 Security

- Webhook validation using secret tokens
- SQL injection prevention via prepared statements
- HTML escaping for user inputs
- Rate limiting for API calls
- No sensitive data in logs

---

Built with ❤️ using Cloudflare Workers and grammY