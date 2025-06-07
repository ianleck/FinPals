# Voice Message Troubleshooting Guide

## 🔍 Debugging Steps

### 1. Check if Voice Messages are Received

Send a voice message in your group. You should see:
```
🎤 Voice message received!
Duration: Xs
File ID: AwACAgIA...
```

If you don't see this, the handler isn't being triggered.

### 2. Check AI Binding

If you see:
```
⚠️ Voice transcription is not available.
```

This means the AI binding is not set up properly.

## 🛠️ Common Issues & Solutions

### Issue: "Voice transcription is not available"

**Solution 1**: Ensure AI binding is in wrangler.toml:
```toml
[ai]
binding = "AI"
```

**Solution 2**: Redeploy after adding the binding:
```bash
npm run deploy
```

### Issue: Voice messages not detected at all

**Solution**: Check if bot is in the group and has message permissions:
1. Remove and re-add the bot to the group
2. Make sure bot is not restricted from reading messages
3. Try sending voice message as a reply to the bot's message

### Issue: Transcription fails

**Possible causes**:
1. Voice file is too large
2. Audio format not supported
3. AI quota exceeded

**Solution**: Use manual entry:
```
/add 20 lunch
```

## 🔧 Manual Testing

### Test 1: Basic Voice Detection
1. Send any voice message
2. Should see "Voice message received!" confirmation

### Test 2: AI Availability
1. Check Cloudflare dashboard → Workers → Your worker → Settings
2. Verify "Workers AI" is enabled
3. Check usage quota

### Test 3: Simple Voice Commands
Try these clear voice messages:
- "Twenty dollars"
- "Fifty for dinner"
- "Add thirty for coffee"

## 📝 Alternative: Voice Message Templates

If voice transcription isn't working, use templates for common expenses:

```bash
/templates create Coffee "Morning coffee" 5
/templates shortcut coffee
```

Then just type `/coffee` instead of using voice!

## 🚨 Emergency Fallback

If voice isn't working at all, the bot will show:
```
🎤 Voice message received!
⚠️ Voice transcription is currently unavailable.

Please type your expense instead:
/add [amount] [description]

Example: /add 20 lunch
```

## 📊 Check Logs

In Cloudflare dashboard:
1. Go to Workers & Pages
2. Select "finpals-telegram"
3. Click "Logs"
4. Look for errors starting with "Voice message"

Common log messages:
- `Voice message handler called` - Handler triggered
- `AI binding not configured` - Missing AI setup
- `Failed to download voice file` - Network issue
- `Whisper API result` - Successful transcription

## 💡 Pro Tips

1. **Speak clearly**: "Add twenty dollars for lunch"
2. **Keep it short**: Under 10 seconds works best
3. **Quiet environment**: Reduce background noise
4. **Numbers first**: "Fifty dollars groceries" vs "Groceries fifty"

## 🔄 Quick Fix Checklist

1. [ ] AI binding added to wrangler.toml
2. [ ] Worker redeployed
3. [ ] Bot has message permissions in group
4. [ ] Voice message under 20MB
5. [ ] Cloudflare AI is enabled in dashboard