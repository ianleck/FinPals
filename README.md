# FinPals - Telegram Expense Tracking Bot

FinPals is a powerful Telegram bot for managing shared expenses within groups. Built on Cloudflare Workers, it offers smart expense tracking, automatic categorization, and seamless financial management.

## 🌟 Key Features

- **Smart Expense Splitting** - Add expenses with flexible splits (equal or custom amounts)
- **Real-time Balances** - Track who owes whom instantly  
- **Smart Participant Suggestions** - Remembers common expense groups
- **Trip Management** - Organize expenses by trips or events
- **Personal Budgets** - Set spending limits with alerts (optional DM feature)
- **Expense Templates** - Quick shortcuts for frequent expenses
- **Data Export** - Export as CSV for external analysis

## 🚀 Quick Start

### 1. Add to Telegram
Search for [@FinPalsBot](https://t.me/FinPalsBot) and add to your group.

### 2. How Member Detection Works
ℹ️ **Telegram Limitation**: Bots can only see members who've interacted. FinPals tracks members when they:
- Send any message in the group
- Are mentioned in an expense (`@username`)
- Join after the bot is added

**Quick Setup**: After adding the bot, either:
- Ask everyone to send a quick "Hi", OR
- Just mention them when adding expenses (`/add 50 lunch @john @mary`)

### 3. Start Using
```
/start - Initialize bot in your group
/add 50 lunch - Add a $50 lunch expense
/balance - See who owes whom
/status - See who's enrolled
/help - View all commands
```

## 💻 Self-Hosting

### Prerequisites
- Telegram Bot Token from [@BotFather](https://t.me/botfather)
- Cloudflare Account (free tier works)
- Node.js 18+

### Setup
```bash
# Clone and install
git clone https://github.com/yourusername/finpals
cd finpals
npm install

# Configure
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml with your account ID

# Set secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TELEGRAM_BOT_API_SECRET_TOKEN

# Deploy
npm run deploy
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup instructions.

## 📱 Commands

### Essential Commands
- `/add 50 lunch` - Add expense (split with everyone)
- `/add 50 lunch @john` - Split with specific people
- `/add 50 lunch @john=30 @sarah=20` - Custom splits
- `/balance` - View who owes whom
- `/settle @john 25` - Record a payment
- `/expenses` - Browse all expenses
- `/help` - View all commands

### Advanced Features
- `/trip start "Bali 2024"` - Track trip expenses
- `/templates create Coffee "Morning coffee" 5` - Create shortcuts
- `/budget set "Food" 500 monthly` - Set spending limits (DM only)
- `/stats` → "View Trends" - Visualize spending patterns

## 💡 How It Works

1. **Add the bot to your group** - No private setup needed
2. **First expense** - Mention participants: `/add 50 lunch @john @mary`  
3. **Future expenses** - Just type: `/add 30 coffee` (bot suggests John & Mary)
4. **Check balances** - `/balance` shows who owes whom
5. **Settle up** - `/settle @john 25` when payment is made

## 🛠️ Development

For development setup, deployment, and contribution guidelines, see [DEVELOPMENT.md](DEVELOPMENT.md).

## 🆘 Support

- **Common Issues**: See troubleshooting in [DEVELOPMENT.md](DEVELOPMENT.md#-troubleshooting)
- **Bug Reports**: [GitHub Issues](https://github.com/yourusername/finpals/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/yourusername/finpals/discussions)

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

---

Built with ❤️ using Cloudflare Workers and grammY