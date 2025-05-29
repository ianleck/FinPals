import { Context } from 'grammy';

// Delete a message after a specified delay
// NOTE: This won't work in Cloudflare Workers due to stateless nature
// Keeping for future implementation with Durable Objects or Queues
export async function deleteMessageAfterDelay(ctx: Context, messageId: number, delayMs: number = 30000): Promise<void> {
	// TODO: Implement with Cloudflare Queues or Durable Objects
	console.log('Message deletion scheduling not implemented in serverless environment');
}

// Delete the user's command message
export async function deleteUserMessage(ctx: Context): Promise<void> {
	try {
		if (ctx.message && ctx.chat && ctx.chat.type !== 'private') {
			console.log(`Attempting to delete message ${ctx.message.message_id} in chat ${ctx.chat.id}`);
			await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
			console.log('Message deleted successfully');
		}
	} catch (error: any) {
		// User might have already deleted or bot lacks permissions
		console.error('Could not delete user message:', error.message || error);
		console.error('Error details:', error);
	}
}

// Send a reply that auto-deletes after a delay
export async function sendTemporaryMessage(
	ctx: Context,
	text: string,
	options: any = {},
	deleteAfterMs: number = 60000 // Default 1 minute
): Promise<void> {
	try {
		const message = await ctx.reply(text, options);
		deleteMessageAfterDelay(ctx, message.message_id, deleteAfterMs);
	} catch (error) {
		console.error('Error sending temporary message:', error);
	}
}

// Constants for different message types
export const MESSAGE_LIFETIMES = {
	ERROR: 15000,        // 15 seconds for errors
	SUCCESS: 30000,      // 30 seconds for success messages
	INFO: 60000,         // 1 minute for informational messages
	INTERACTIVE: 300000, // 5 minutes for messages with buttons
	PERMANENT: -1        // Don't delete
};