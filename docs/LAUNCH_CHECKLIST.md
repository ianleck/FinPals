# FinPals Launch Checklist

## 🚀 Pre-Launch Setup

### 1. Environment Configuration
- [ ] Set `BOT_TOKEN` in production
- [ ] Set `TELEGRAM_BOT_API_SECRET_TOKEN` 
- [ ] Set `ENV=production`
- [ ] Update database IDs in wrangler.toml

### 2. Database Setup
```sql
-- Apply performance indexes
CREATE INDEX idx_expenses_group_created ON expenses(group_id, created_at DESC);
CREATE INDEX idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX idx_settlements_group ON settlements(group_id);
CREATE INDEX idx_group_members_group ON group_members(group_id, active);
```

### 3. Bot Configuration
```bash
# Set webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d '{"url": "https://your-worker.workers.dev", "secret_token": "YOUR_SECRET"}'

# Register commands
curl https://your-worker.workers.dev/api/set-commands
```

### 4. Verification
- [ ] Test with small group
- [ ] Verify webhook is receiving updates
- [ ] Check all commands work
- [ ] Monitor error logs for 24 hours

## 📊 Launch Metrics

### Week 1 Goals
- 50% of groups add 3+ expenses
- 30% of groups have 3+ active users
- <100ms response time maintained

### Month 1 Targets
- 1,000 active groups
- 40% retention rate
- 5 expenses per active group/week

## 🚨 Known Limitations

### Telegram Constraints
- Can't resolve @mentions unless user has interacted with bot
- Need admin rights for message deletion
- 30 messages/second rate limit

### D1 Free Tier Limits
- 5GB storage
- 5M reads/day
- 100k writes/day

## 📈 Post-Launch Plan

### Week 1-2: Monitor & Fix
- Track error rates
- Fix critical bugs
- Gather user feedback

### Week 3-4: Optimize
- Improve slow queries
- Add most requested features
- Enhance error messages

### Month 2: Growth
- Submit to bot directories
- Create landing page
- Launch referral program

## 🆘 Support Setup
- Create @FinPalsSupport channel
- Set up error monitoring
- Create FAQ document
- Enable feedback collection

---

**Ready to launch?** Deploy → Verify → Monitor → Announce! 🎉