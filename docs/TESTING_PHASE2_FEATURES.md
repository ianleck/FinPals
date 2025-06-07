# Testing Phase 2 Features - Complete Guide

## 🚀 Setup

1. **Deploy to Cloudflare Workers** (if not already done):
```bash
npm run deploy
```

2. **Set webhook** (replace with your bot token and worker URL):
```bash
curl -X POST https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-worker.workers.dev"}'
```

3. **Run database migrations**:
```bash
npm run migrations
```

## 📱 Feature Testing Guide

### 1. 🎤 Voice Message Support

**How to test:**
1. In a group chat where the bot is added
2. Record a voice message saying: "Add twenty dollars for lunch"
3. Send the voice message
4. Bot should:
   - Show "🎤 Processing voice message..."
   - Display transcription
   - Show detected amount and description
   - Provide Confirm/Cancel buttons

**Test variations:**
- "Add fifty bucks for uber"
- "Twenty-five dollars for coffee"
- "Spent thirty on groceries"

---

### 2. 📸 Receipt OCR Scanning

**How to test:**
1. Take a photo of any receipt (or use a receipt image)
2. Send the photo to the group chat
3. Bot should:
   - Show "🔍 Processing receipt..."
   - Extract total amount
   - Detect vendor name
   - Show receipt details
   - Automatically create expense

**Tips:**
- Ensure receipt is clear and well-lit
- Works with restaurant bills, grocery receipts, etc.

---

### 3. 📝 Expense Templates

**Create a template:**
```
/templates create Coffee "Morning coffee" 5.50
```

**Set a shortcut:**
```
/templates shortcut coffee
```

**Use the shortcut:**
```
/coffee
```
This will automatically add a $5.50 coffee expense!

**Other template commands:**
- `/templates` - View all your templates
- `/templates delete Coffee` - Delete a template
- `/templates suggest` - Get template suggestions based on frequent expenses

---

### 4. 👥 Smart Participant Suggestions

**How to test:**
1. Add an expense without mentioning anyone:
```
/add 50 lunch
```

2. If you've had similar expenses before, bot will:
   - Show "💡 Adding Expense" UI
   - Display suggested participants based on history
   - Show buttons to toggle participants
   - "Add All Suggested" and "Add Everyone" options

**Building history:**
- First add some expenses with specific people: `/add 30 coffee @alice @bob`
- Then try `/add 25 coffee` - it should suggest Alice and Bob

---

### 5. 🔄 Recurring Expense Detection

**Build pattern (over several days):**
```
Day 1: /add 15 uber to work
Day 8: /add 15 uber to office  
Day 15: /add 16 uber work
```

**Check detection:**
The bot will detect this as a weekly pattern and send reminders when the next expense is due.

**Note:** Reminders run daily at 9 AM UTC via scheduled job.

---

### 6. 📊 Spending Trends Visualization

**View trends:**
```
/stats
```
Then click "📈 View Trends"

**Features:**
- Monthly spending overview
- Category breakdown with percentages
- Visual bar charts
- Month-over-month comparisons
- Spending insights

---

### 7. 💰 Budget Alerts

**Set a budget (in DM with bot):**
```
/budget set "Food & Dining" 500 monthly
/budget set "Transportation" 100 weekly
```

**Test alerts:**
- Add expenses in those categories
- When you hit 75%, 90%, or exceed budget, you'll get DM alerts
- Alerts show remaining budget and suggestions

**View budgets:**
```
/budget view
```

---

### 8. ⚡ Enhanced Commands

**Enhanced Add Command:**
- Now shows participant suggestions UI
- Interactive selection with buttons
- Better error messages

**Enhanced Help Command:**
- Shows your personal template shortcuts
- Context-aware (different help in groups vs DM)
- More organized command listing

---

## 🧪 Testing Scenarios

### Scenario 1: Travel Group
1. Create templates for common travel expenses:
   ```
   /templates create Uber "Uber ride" 25
   /templates create Hotel "Hotel night" 150
   ```
2. Set shortcuts: `/templates shortcut uber`
3. Use throughout trip: `/uber`, `/hotel`
4. Check spending trends: `/stats` → "View Trends"

### Scenario 2: Roommate Expenses
1. Set monthly budgets for shared categories
2. Add recurring expenses (rent, utilities)
3. Watch for reminder notifications
4. Monitor budget alerts

### Scenario 3: Restaurant Bill
1. Take photo of receipt
2. Bot extracts amount
3. Review suggested participants
4. Confirm split

---

## 🐛 Troubleshooting

**Voice messages not working?**
- Ensure bot has permission to access messages
- Check Cloudflare AI is enabled in wrangler.toml

**Receipt OCR failing?**
- Image must be clear and readable
- Try better lighting
- Ensure receipt text is not blurry

**No participant suggestions?**
- Need expense history first
- Add a few expenses with mentions to build patterns

**No recurring reminders?**
- Patterns need at least 3 occurrences
- Wait for daily cron job (9 AM UTC)
- Check similarity in descriptions

---

## 📋 Quick Test Checklist

- [ ] Voice: "Add thirty dollars for dinner"
- [ ] Photo: Send receipt image
- [ ] Template: `/templates create` then use shortcut
- [ ] Suggestions: `/add 50 lunch` (after building history)
- [ ] Trends: `/stats` → "View Trends"
- [ ] Budget: Set budget, exceed it, check for alert
- [ ] Help: `/help` shows your shortcuts

---

## 🔧 Debug Mode

For developers, test error handling:
```
/test
```

Check bot status:
```
curl https://your-worker.workers.dev/test
```

View logs in Cloudflare dashboard under Workers → Logs.