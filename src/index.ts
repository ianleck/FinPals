/**
 * FinPals Telegram Bot - Main Entry Point
 * Handles webhook routing and bot initialization
 */

import { Bot, Context, webhookCallback } from 'grammy';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { createDb } from './db';
import { COMMANDS } from './utils/constants';
import { trackGroupMetadata } from './utils/group-tracker';
import { logger } from './utils/logger';

// Import command handlers
import { handleStart } from './commands/start';
import { handleAdd } from './commands/add';
import { handleBalance } from './commands/balance';
import { handleSettle } from './commands/settle';
import { handleStats } from './commands/stats';
import { handleHistory } from './commands/history';
import { handleExpenses, handleExpenseSelection } from './commands/expenses';
import { handleDelete } from './commands/delete';
import { handleEdit } from './commands/edit';
import { handleTest } from './commands/test';
import { handleInfo } from './commands/info';

// Import callback handlers
import { registerExpenseCallbacks } from './handlers/expense-callbacks';
import { registerSettlementCallbacks } from './handlers/settlement-callbacks';
import { registerNavigationCallbacks } from './handlers/navigation-callbacks';

type MyContext = Context & { env: Env };

export interface Env {
	BOT_TOKEN: string;
	TELEGRAM_BOT_API_SECRET_TOKEN: string;
	ENV: string;
	HYPERDRIVE: { connectionString: string };
	SESSIONS: DurableObjectNamespace;
}

const corsHeaders = {
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
	'Access-Control-Allow-Headers':
		'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
};

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(request.url);

		// Test endpoint
		if (url.pathname === '/test' && request.method === 'GET') {
			return new Response('Bot is running! Webhook endpoint: ' + request.url.replace('/test', ''), {
				status: 200,
				headers: corsHeaders,
			});
		}

		// Set commands endpoint
		if (url.pathname === '/api/set-commands') {
			return handleSetCommands(env);
		}

		// Handle bot webhook
		try {
			const bot = new Bot<MyContext>(env.BOT_TOKEN);

			// Track group metadata
			bot.use(async (ctx, next) => {
				ctx.env = env;
				try {
					await trackGroupMetadata(ctx);
				} catch (error) {
					logger.error('Error tracking group metadata', error);
				}
				return next();
			});

			// Create database instance
			const db = createDb(env);

			// Handle bot being added to groups
			bot.on('my_chat_member', async (ctx) => {
				logger.info('my_chat_member event', {
					newStatus: ctx.myChatMember.new_chat_member.status,
					chatType: ctx.chat.type,
					chatId: ctx.chat.id,
				});

				// Bot was added to a group
				if (ctx.myChatMember.new_chat_member.status === 'member' && ctx.chat.type !== 'private') {
					await handleStart(ctx, db);
				}

				// Bot was made admin in a group
				if (ctx.myChatMember.new_chat_member.status === 'administrator' && ctx.chat.type !== 'private') {
					await handleStart(ctx, db);
				}
			});

			// Register command handlers
			registerCommands(bot, db, env);

			// Register callback handlers
			registerExpenseCallbacks(bot);
			registerSettlementCallbacks(bot);
			registerNavigationCallbacks(bot);

			// Handle special text patterns
			registerTextHandlers(bot, db);

			// Process webhook
			const response = await webhookCallback(bot, 'cloudflare-mod', {
				secretToken: env.TELEGRAM_BOT_API_SECRET_TOKEN,
				timeoutMilliseconds: 25000,
			})(request);

			// Add CORS headers
			const newHeaders = new Headers(response.headers);
			Object.entries(corsHeaders).forEach(([key, value]) => {
				newHeaders.set(key, value);
			});

			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: newHeaders,
			});
		} catch (error) {
			logger.error('Error in bot', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			// Return 200 OK to prevent Telegram from retrying
			return new Response('OK', {
				status: 200,
				headers: { ...corsHeaders, 'content-type': 'text/plain' },
			});
		}
	},
};

/**
 * Register command handlers
 */
function registerCommands(bot: Bot<MyContext>, db: any, env: Env) {
	bot.command(COMMANDS.START, (ctx) => handleStart(ctx, db));
	bot.command(COMMANDS.ADD, (ctx) => handleAdd(ctx, db));
	bot.command(COMMANDS.BALANCE, (ctx) => handleBalance(ctx, env));
	bot.command(COMMANDS.SETTLE, (ctx) => handleSettle(ctx, db));
	bot.command(COMMANDS.HISTORY, (ctx) => handleHistory(ctx, db));
	bot.command(COMMANDS.STATS, (ctx) => handleStats(ctx, db));
	bot.command(COMMANDS.EXPENSES, (ctx) => handleExpenses(ctx, db));
	bot.command(COMMANDS.EDIT, (ctx) => handleEdit(ctx, db));
	bot.command(COMMANDS.DELETE, (ctx) => handleDelete(ctx, db));
	bot.command(COMMANDS.INFO, (ctx) => handleInfo(ctx));
	bot.command('test', (ctx) => handleTest(ctx));
}

/**
 * Register text pattern handlers
 */
function registerTextHandlers(bot: Bot<MyContext>, db: any) {
	// Handle delete with underscore format
	bot.hears(/^\/delete_/, (ctx) => handleDelete(ctx, db));

	// Handle view expense from search results
	bot.hears(/^\/view_/, async (ctx) => {
		const expenseId = ctx.message?.text?.split('_')[1];
		if (expenseId) {
			// Create fake callback context
			ctx.callbackQuery = {
				data: `exp:0:${expenseId}`,
				message: ctx.message,
			} as any;
			await handleExpenseSelection(ctx, db);
		}
	});
}

/**
 * Handle set commands API endpoint
 */
async function handleSetCommands(env: Env): Promise<Response> {
	try {
		const bot = new Bot<MyContext>(env.BOT_TOKEN);
		const commands = [
			{ command: COMMANDS.START, description: 'Initialize bot in group or get help' },
			{ command: COMMANDS.ADD, description: 'Add a new expense' },
			{ command: COMMANDS.BALANCE, description: 'Show current balances' },
			{ command: COMMANDS.SETTLE, description: 'Record a payment' },
			{ command: COMMANDS.HISTORY, description: 'View recent transactions' },
			{ command: COMMANDS.STATS, description: 'View group statistics' },
			{ command: COMMANDS.EXPENSES, description: 'List all expenses' },
			{ command: COMMANDS.EDIT, description: 'Edit an expense' },
			{ command: COMMANDS.DELETE, description: 'Delete an expense' },
			{ command: COMMANDS.INFO, description: 'Get detailed help for a command' },
		];

		// Set commands for group chats
		await bot.api.setMyCommands(commands, {
			scope: { type: 'all_group_chats' },
		});

		// Set limited commands for private chats
		await bot.api.setMyCommands(
			[
				{ command: COMMANDS.START, description: 'Get started with FinPals' },
				{ command: COMMANDS.ADD, description: 'Add a personal expense' },
				{ command: COMMANDS.EXPENSES, description: 'View your expenses' },
				{ command: COMMANDS.STATS, description: 'View statistics' },
				{ command: COMMANDS.INFO, description: 'Get detailed help for a command' },
			],
			{
				scope: { type: 'all_private_chats' },
			},
		);

		return new Response(JSON.stringify({ success: true, message: 'Commands set successfully' }), {
			status: 200,
			headers: { ...corsHeaders, 'content-type': 'application/json' },
		});
	} catch (error: any) {
		logger.error('Error setting commands', error);
		return new Response(
			JSON.stringify({
				success: false,
				error: error.message || 'Failed to set commands',
			}),
			{
				status: 500,
				headers: { ...corsHeaders, 'content-type': 'application/json' },
			},
		);
	}
}

export default worker;

// Export Durable Object for session storage
export { SessionDO } from './SessionDO';
