# FinPals Troubleshooting Guide

## 🔍 Common Issues & Solutions

### Bot Not Responding

**Symptoms**: Bot doesn't respond to commands in group

**Solutions**:
1. Ensure bot is added to group as admin
2. Check webhook status:
   ```bash
   curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```
3. Verify bot has message permissions
4. Try `/start` command first
5. Check logs: `npx wrangler tail`

### Voice Messages Not Working

**Symptoms**: "Voice transcription is not available" message

**Solutions**:
1. Verify AI binding in `wrangler.toml`:
   ```toml
   [ai]
   binding = "AI"
   ```
2. Redeploy after adding binding
3. Check Cloudflare AI is enabled in dashboard
4. Ensure voice message is under 20MB
5. Try clear, short messages (under 10 seconds)

**Alternative**: Use expense templates for quick entry instead

### Receipt OCR Failing

**Symptoms**: Receipt photos not processed

**Solutions**:
1. Ensure image is clear and well-lit
2. Check file size (under 10MB)
3. Verify AI binding is configured
4. Try PNG/JPG formats only

### Database Errors

**Symptoms**: "Something went wrong" messages

**Solutions**:
1. Check D1 database status in Cloudflare dashboard
2. Verify migrations are applied:
   ```bash
   npx wrangler d1 execute finpals-db --remote --file=./schema.sql
   ```
3. Check for D1 quota limits (5M reads/day on free tier)

### Webhook Issues

**Symptoms**: Bot receives commands late or not at all

**Solutions**:
1. Re-set webhook with secret token:
   ```bash
   curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook \
     -d "url=https://your-worker.workers.dev&secret_token=YOUR_SECRET"
   ```
2. Verify worker is deployed and running
3. Check webhook info for errors

### Performance Issues

**Symptoms**: Slow responses or timeouts

**Solutions**:
1. Check worker analytics for CPU time
2. Look for N+1 query patterns
3. Ensure indexes are created:
   ```sql
   CREATE INDEX idx_expenses_group ON expenses(group_id, deleted);
   CREATE INDEX idx_expense_splits_user ON expense_splits(user_id);
   ```
4. Consider upgrading Cloudflare plan for higher limits

## 🧪 Quick Tests

### Test 1: Basic Functionality
```
/test
```
Should return bot status and basic info

### Test 2: Voice Messages
1. Record: "Add twenty dollars for lunch"
2. Should see transcription and confirmation buttons

### Test 3: Database Connection
```
/add 10 test
```
Should add expense and show confirmation

### Test 4: AI Features
Send a receipt photo - should extract amount

## 📊 Debugging Commands

### View Logs
```bash
# Real-time logs
npx wrangler tail

# Filter errors only
npx wrangler tail --format json | grep ERROR
```

### Check Database
```bash
# Query database locally
npx wrangler d1 execute finpals-db --local --command "SELECT COUNT(*) FROM expenses"

# Check production
npx wrangler d1 execute finpals-db-prod --remote --command "SELECT COUNT(*) FROM users"
```

### Test Webhook
```bash
# Get webhook info
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo

# Send test update
curl -X POST https://your-worker.workers.dev/test
```

## 🚨 Error Messages

### "Rate limited"
- Too many requests in short time
- Implement exponential backoff
- Check for loops in code

### "User not in group"
- User needs to send a message first
- Bot can't resolve @mentions for inactive users
- Use `/status` to check enrollment

### "Invalid amount"
- Amount must be positive number
- Maximum 2 decimal places
- Under $999,999.99

## 💡 Pro Tips

1. **Development**: Use `npm run dev` with local tunnel for testing
2. **Monitoring**: Set up Cloudflare Email alerts for errors
3. **Backup**: Export data regularly with `/export`
4. **Testing**: Create test group with few members first

## 🆘 Still Need Help?

1. Check error logs: `npx wrangler tail`
2. Review [DEVELOPMENT.md](../DEVELOPMENT.md) for setup details
3. Search [GitHub Issues](https://github.com/yourusername/finpals/issues)
4. Ask in [Discussions](https://github.com/yourusername/finpals/discussions)

---

[Back to README](../README.md) | [Development Guide](../DEVELOPMENT.md)