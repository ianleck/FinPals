# Product Requirements Document: FinPals - Telegram Expense Splitting Bot

## 1. Product Overview

**FinPals** is a Telegram bot that makes splitting expenses effortless within existing group chats. Unlike traditional expense trackers, FinPals focuses on the social dynamics of shared expenses, making it the Splitwise of Telegram.

### Key Differentiators

- **Group-native**: Works directly in existing Telegram groups
- **Split-first**: Expense splitting is the primary feature, not tracking
- **Zero friction**: No app downloads, account creation, or friend requests
- **Smart defaults**: AI-powered categorization and participant detection

## 2. Problem Statement

Current expense tracking bots like Cointry focus on individual budgeting, missing the core social use case. Users need:

- Quick expense splitting in group contexts (trips, roommates, dinners)
- Clear visibility of who owes whom
- Easy settlement tracking
- No app-switching friction

## 3. Target Users

### Primary Segments

1. **Travel Groups** (Highest value)

   - Friends planning trips together
   - High transaction volume over short periods
   - Clear start/end dates

2. **Roommates**

   - Recurring shared expenses
   - Long-term usage
   - Regular settlements

3. **Friend Groups**
   - Restaurant bills, events, activities
   - Intermittent but consistent usage

### User Personas

- **Sarah (Travel Organizer)**: Plans group trips, needs to track all shared expenses
- **Mike (Roommate)**: Splits rent, utilities, groceries monthly
- **John (Social Connector)**: Frequently organizes group dinners and events

## 4. Core Features (MVP)

### 4.1 Expense Management

- **Quick Add**: Natural language expense entry
- **Smart Splitting**: Even split by default, custom splits supported
- **Multi-currency**: Automatic conversion with cached rates
- **Participant Detection**: Auto-detect from mentions or group context

### 4.2 Balance Tracking

- **Live Balances**: Real-time who-owes-whom view
- **Settlement Recording**: Track payments between users
- **Balance History**: See how balances evolved over time

### 4.3 Group Features

- **Group Isolation**: Separate tracking per group
- **Member Management**: Handle people joining/leaving
- **Group Stats**: Total expenses, most active splitter, etc.

### 4.4 Personal Features

- **Cross-group Summary**: See all balances across groups
- **Personal Expenses**: Track solo expenses (hidden from group)
- **Spending Insights**: Category breakdowns, trends

### 4.5 Smart Features

- **AI Categorization**: Auto-categorize based on description
- **Pattern Learning**: Suggest participants based on history
- **Recurring Detection**: Identify regular expenses

## 5. Technical Requirements

### 5.1 Infrastructure

- **Platform**: Cloudflare Workers (TypeScript)
- **Bot Framework**: Grammy
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Workers KV
- **State**: Durable Objects
- **Queue**: Cloudflare Queues

### 5.2 Performance

- Response time: <100ms for all commands
- Availability: 99.9% uptime
- Scale: Support 100K+ active groups

### 5.3 Security

- User data encrypted at rest
- Group isolation enforced
- No cross-group data leakage
- Rate limiting per user/group

## 6. Database Schema

```sql
-- Users table
CREATE TABLE users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    timezone TEXT DEFAULT 'UTC',
    preferred_currency TEXT DEFAULT 'USD',
    premium_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Groups table
CREATE TABLE groups (
    telegram_id TEXT PRIMARY KEY,
    title TEXT,
    default_currency TEXT DEFAULT 'USD',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
);

-- Group members junction table
CREATE TABLE group_members (
    group_id TEXT,
    user_id TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Expenses table
CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    description TEXT,
    category TEXT,
    paid_by TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (paid_by) REFERENCES users(telegram_id),
    FOREIGN KEY (created_by) REFERENCES users(telegram_id)
);

-- Expense participants
CREATE TABLE expense_splits (
    expense_id TEXT,
    user_id TEXT,
    amount REAL NOT NULL,
    PRIMARY KEY (expense_id, user_id),
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Settlements
CREATE TABLE settlements (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(telegram_id),
    FOREIGN KEY (from_user) REFERENCES users(telegram_id),
    FOREIGN KEY (to_user) REFERENCES users(telegram_id)
);

-- User preferences
CREATE TABLE user_preferences (
    user_id TEXT PRIMARY KEY,
    notifications BOOLEAN DEFAULT TRUE,
    weekly_summary BOOLEAN DEFAULT TRUE,
    auto_remind BOOLEAN DEFAULT FALSE,
    reminder_days INTEGER DEFAULT 7,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Categories for AI training
CREATE TABLE category_mappings (
    description_pattern TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    usage_count INTEGER DEFAULT 1
);
```

## 7. User Flows

### 7.1 First Time User Flow

1. User adds @FinPals to group
2. Bot sends welcome message with quick tutorial
3. User tries first `/add` command
4. Bot confirms expense and shows balances
5. Bot suggests next actions (view balance, add more)

### 7.2 Add Expense Flow

```
User: /add 120 lunch
Bot: ✅ Added "lunch" - $120
     Split between: @john @sarah @mike @emma ($30 each)
     Paid by: @john

     [Adjust Split] [Change Payer] [Add Receipt]
```

### 7.3 Settlement Flow

```
User: /settle @mike 30
Bot: 💰 Settlement recorded!
     @mike paid @john $30

     New balance: @mike owes @john $0

     [View All Balances] [Add Another Settlement]
```

## 8. Command Reference

### Core Commands

- `/start` - Initialize bot in group/private
- `/add [amount] [description] [@mentions]` - Add expense
- `/balance` - Show current balances
- `/settle @user [amount]` - Record settlement
- `/history` - Show recent transactions
- `/stats` - Group statistics
- `/help` - Show command list

### Advanced Commands

- `/expenses` - Detailed expense list
- `/category [expense_id] [category]` - Recategorize
- `/delete [expense_id]` - Remove expense
- `/currency [code]` - Set default currency
- `/export` - Export data as CSV
- `/summary [month]` - Monthly summary

### Quick Actions (Inline Buttons)

- Split adjustment (equal/percentage/amounts)
- Quick settle (one-tap for exact balance)
- Category selection
- Receipt upload

## 9. Message Templates

### Welcome Message

```
👋 Welcome to FinPals!

I'll help your group track shared expenses. Here's how:

💵 Add expense: /add 50 dinner
👥 Auto-splits between active members
💰 Track who owes whom: /balance
✅ Record payments: /settle @friend 25

Ready? Try: /add 20 coffee
```

### Expense Confirmation

```
✅ Added: [Description]
💵 Amount: $[Amount]
👤 Paid by: @[Payer]
👥 Split between: [Participants] ($[Amount] each)
📁 Category: [Category]

[Edit Split] [Change Details] [Delete]
```

### Balance Report

```
💰 Current Balances for [Group Name]

@sarah owes:
  → @john: $45.50
  → @mike: $12.00

@mike owes:
  → @john: $23.00

Total unsettled: $80.50

[Settle Up] [View History] [Send Reminders]
```

## 10. Success Metrics

### Activation (Week 1)

- 50% of groups add 3+ expenses
- 30% of groups have 3+ active users
- Average 5 expenses per active group

### Retention (Month 1)

- 40% of groups still active
- 20% of users use personal tracking
- 15% settlement rate

### Growth

- 60% of new users from group invites
- 3.5 average group size
- 25% of users in multiple groups

### Revenue (Month 6)

- 5% convert to premium
- $3 average revenue per premium user
- 70% premium retention

## 11. MVP Implementation Priority

### Phase 1: Core Splitting (Week 1-2)

1. Basic bot setup with Grammy
2. `/add` command with even splits
3. `/balance` calculation
4. `/settle` recording
5. Group isolation

### Phase 2: Enhanced UX (Week 3-4)

1. Inline keyboards for adjustments
2. Natural language parsing
3. Multi-currency support
4. `/history` and `/stats`
5. Error handling

### Phase 3: Intelligence (Week 5-6)

1. AI categorization
2. Participant suggestions
3. Recurring expense detection
4. Personal expense tracking
5. Analytics

## 12. Future Enhancements

### Near-term (3 months)

- Receipt OCR scanning
- Payment app integrations
- Expense templates
- Budget warnings
- Web dashboard

### Long-term (6+ months)

- Business expense management
- Tax categorization
- Credit card statement import
- Crypto settlements
- API for external apps

## 13. Configuration & Environment Variables

```toml
# wrangler.toml structure
BOT_TOKEN = "telegram_bot_token"
WEBHOOK_SECRET = "random_secret"
OPENAI_API_KEY = "for_categorization"
DEFAULT_CURRENCY = "USD"
PREMIUM_PRICE = "2.99"
```

## 14. Error Handling

### User Errors

- Invalid amount: "Please enter a valid number"
- No participants: "Tag people to split with (@username)"
- User not in group: "Please add @username to the group first"

### System Errors

- Database failure: Fallback to cached data
- API timeout: Retry with exponential backoff
- Rate limit: Queue for later processing

## 15. Analytics Events

Track these events for product insights:

- `expense_added` - With amount, participant count
- `settlement_recorded` - With days_outstanding
- `balance_viewed` - With balance_count
- `command_used` - With command_name
- `error_occurred` - With error_type

---

This PRD provides the complete blueprint for building FinPals. Start with Phase 1 commands and gradually add intelligence features. The focus should always be on reducing friction for group expense splitting.
