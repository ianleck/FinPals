import { Context } from 'grammy';

// Helper function to get message thread ID if it exists and is supported
export function getMessageThreadId(ctx: Context): number | undefined {
	// Get the potential thread ID first
	const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;

	// If there's no thread ID, no need to check further
	if (!threadId) {
		return undefined;
	}

	// Check if this is a forum-enabled supergroup
	// is_forum property indicates if the supergroup has topics enabled
	if (ctx.chat?.type === 'supergroup' && 'is_forum' in ctx.chat && ctx.chat.is_forum === true) {
		return threadId;
	}

	// For all other cases (basic groups, non-forum supergroups, etc), don't use thread IDs
	return undefined;
}

// Helper function to create reply options with thread ID if needed
export function createReplyOptions(ctx: Context, additional: Record<string, any> = {}): Record<string, any> {
	const threadId = getMessageThreadId(ctx);
	const { message_thread_id: _, ...rest } = additional; // Remove any thread ID from additional options
	return {
		...(threadId ? { message_thread_id: threadId } : {}),
		...rest,
	};
}