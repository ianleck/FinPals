import { Context } from 'grammy';
import { ERROR_MESSAGES } from './constants';
import { logger } from './logger';

// PostgreSQL/CockroachDB error codes
const PG_ERROR_CODES = {
	UNIQUE_VIOLATION: '23505',
	FOREIGN_KEY_VIOLATION: '23503',
	NOT_NULL_VIOLATION: '23502',
	CHECK_VIOLATION: '23514',
	SERIALIZATION_FAILURE: '40001',
	DEADLOCK_DETECTED: '40P01',
} as const;

export async function withErrorHandler<T>(ctx: Context, operation: () => Promise<T>, errorMessage?: string): Promise<T | void> {
	try {
		return await operation();
	} catch (error) {
		logger.error('Error in operation', error);

		// Handle PostgreSQL/CockroachDB specific error types
		const errorCode = (error as any)?.code;
		switch (errorCode) {
			case PG_ERROR_CODES.UNIQUE_VIOLATION:
				await ctx.reply('❌ This operation would create a duplicate entry.');
				break;
			case PG_ERROR_CODES.FOREIGN_KEY_VIOLATION:
				await ctx.reply('❌ Referenced data does not exist.');
				break;
			case PG_ERROR_CODES.NOT_NULL_VIOLATION:
				await ctx.reply('❌ Required information is missing.');
				break;
			case PG_ERROR_CODES.SERIALIZATION_FAILURE:
				await ctx.reply('⚠️ Database is busy, please try again.');
				break;
			case PG_ERROR_CODES.DEADLOCK_DETECTED:
				await ctx.reply('⚠️ Operation conflict detected, please try again.');
				break;
			case 'PERMISSIONS_REQUIRED':
				await ctx.reply('❌ I need admin permissions to do that.');
				break;
			default:
				// Generic error
				await ctx.reply(errorMessage || ERROR_MESSAGES.DATABASE_ERROR);
		}
	}
}
