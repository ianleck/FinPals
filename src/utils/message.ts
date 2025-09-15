import { Context } from 'grammy';
import { reply } from './reply';
import { logger } from './logger';

export { MESSAGE_LIFETIMES } from './message-cleanup';

// Send a reply and delete the user message (bot message deletion not supported in serverless)
export async function replyAndCleanup(ctx: Context, text: string, options: Record<string, unknown> = {}): Promise<void> {
	try {
		// Delete user's command message immediately
		if (ctx.message && ctx.chat && ctx.chat.type !== 'private') {
			ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
		}

		// Send reply using the topic-aware reply function
		await reply(ctx, text, options);

		// Note: Auto-deletion of bot messages not supported in serverless environment
		// Would need Cloudflare Queues or similar to implement
	} catch (error) {
		logger.error('Error in replyAndCleanup', error);
	}
}
