import { Context } from 'grammy';
import { ERROR_MESSAGES } from './constants';

export class BotError extends Error {
	constructor(message: string, public code: string, public userMessage: string = ERROR_MESSAGES.DATABASE_ERROR) {
		super(message);
		this.name = 'BotError';
	}
}

export async function withErrorHandler<T>(ctx: Context, operation: () => Promise<T>, errorMessage?: string): Promise<T | void> {
	try {
		return await operation();
	} catch (error: any) {
		console.error('Error in operation:', error);

		// Handle specific error types
		if (error.code === 'SQLITE_CONSTRAINT') {
			await ctx.reply('❌ This operation would create a duplicate entry.');
			return;
		}

		if (error.code === 'PERMISSIONS_REQUIRED') {
			await ctx.reply('❌ I need admin permissions to do that.');
			return;
		}

		// Generic error
		await ctx.reply(errorMessage || ERROR_MESSAGES.DATABASE_ERROR);
	}
}
