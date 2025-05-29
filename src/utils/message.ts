import { Context } from 'grammy';
import { MESSAGE_LIFETIMES } from './message-cleanup';
import { reply } from './reply';

export { MESSAGE_LIFETIMES } from './message-cleanup';


// Send a reply and delete the user message (bot message deletion not supported in serverless)
export async function replyAndCleanup(
	ctx: Context,
	text: string,
	options: any = {},
	_deleteAfterMs: number = MESSAGE_LIFETIMES.INFO  // Not used in serverless environment
): Promise<void> {
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
		console.error('Error in replyAndCleanup:', error);
	}
}