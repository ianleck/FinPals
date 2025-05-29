# Supergroup Topic Support

## What was fixed

The bot now properly supports Telegram supergroups with topics (forum mode). When users send commands in a specific topic, the bot will reply to that same topic instead of the general chat.

## Technical Implementation

1. **Created `src/utils/reply.ts`** - A wrapper around `ctx.reply()` that:
   - Detects if the chat is a forum-enabled supergroup
   - Extracts the `message_thread_id` from the context
   - Includes the thread ID in reply options to ensure messages go to the correct topic

2. **Updated key command files** to use the topic-aware reply function:
   - `add.ts` - Expense addition commands
   - `balance.ts` - Balance checking
   - `budget.ts` - Budget management
   - `settle.ts` - Settlement recording
   - And others...

3. **Updated `replyAndCleanup`** utility to use the new reply function

## How it works

```typescript
// The reply function checks for forum supergroups
const isForumSupergroup = ctx.chat?.type === 'supergroup' && 
                         'is_forum' in ctx.chat && 
                         ctx.chat.is_forum === true;

// If it's a forum, it includes the thread ID
if (isForumSupergroup && threadId) {
    replyOptions.message_thread_id = threadId;
}
```

## Result

- ✅ Bot replies stay in the correct topic thread
- ✅ Works for both regular supergroups and forum-enabled supergroups
- ✅ Backwards compatible with regular groups and private chats
- ✅ No changes needed to bot permissions or settings