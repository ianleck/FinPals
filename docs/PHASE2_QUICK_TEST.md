# Phase 2 Features - Quick Test Reference 🚀

## 🎯 Quick Commands to Test Each Feature

### 1. Voice Message 🎤
- Record: "Add twenty dollars for lunch"
- Send voice message to group

### 2. Receipt OCR 📸
- Take photo of any receipt
- Send to group chat

### 3. Templates ⚡
```bash
/templates create Coffee "Morning coffee" 5.50
/templates shortcut coffee
/coffee  # Quick add!
```

### 4. Smart Suggestions 👥
```bash
# First, build history:
/add 30 coffee @alice @bob
/add 25 coffee @alice @bob

# Then test suggestions:
/add 20 coffee
# Bot will suggest Alice & Bob!
```

### 5. Spending Trends 📊
```bash
/stats
# Click "📈 View Trends"
```

### 6. Budget Alerts 💰
```bash
# In DM with bot:
/budget set "Food & Dining" 100 monthly

# In group:
/add 80 dinner  # Will trigger 80% alert
/add 30 lunch   # Will trigger exceeded alert
```

### 7. Enhanced Help 📚
```bash
/help  # Shows your personal shortcuts
```

## 🔥 Power User Combo Test

1. **Setup Phase** (in DM):
   ```bash
   /budget set "Food & Dining" 200 monthly
   /templates create Lunch "Team lunch" 25
   /templates shortcut lunch
   ```

2. **Usage Phase** (in group):
   - Send receipt photo of lunch
   - Or use voice: "Add twenty-five dollars for lunch"
   - Or use shortcut: `/lunch`

3. **Analysis Phase**:
   ```bash
   /stats → View Trends
   /balance
   /expenses
   ```

## ⚡ 30-Second Feature Demo

1. 🎤 **Voice**: "Add fifteen dollars for coffee"
2. 📸 **Photo**: Snap & send any receipt
3. 📊 **Stats**: `/stats` → Click trends
4. ⚡ **Template**: `/coffee` (after setup)

## 🎮 Fun Test Scenarios

### "The Coffee Addict"
```bash
/templates create Coffee "Daily fix" 5
/templates shortcut coffee
# Use daily: /coffee
# Check weekly: /stats → trends
```

### "The Organizer"
```bash
# Set budgets for everything
/budget set "Food & Dining" 500 monthly
/budget set "Transportation" 200 monthly
/budget set "Entertainment" 150 monthly
# Watch the alerts roll in!
```

### "The Voice Commander"
- "Add fifty dollars for groceries"
- "Twenty bucks for uber"
- "Hundred and twenty for dinner with team"

---

💡 **Pro Tip**: Build expense history first for best results with suggestions and patterns!