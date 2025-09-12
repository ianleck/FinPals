import { Bot, Context, SessionFlavor, webhookCallback } from 'grammy';
import { setupSession } from './utils/session';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { createDb, type Database } from './db';
import { handleStart } from './commands/start';
import { handleAdd } from './commands/add';
import { handleBalance } from './commands/balance';
import { handleSettle, handleSettleCallback } from './commands/settle';
import { handleStats } from './commands/stats';
import { handleHistory } from './commands/history';
import { handleExpenses, handleExpenseSelection } from './commands/expenses';
import { handleDelete } from './commands/delete';
import { handleEdit, handleEditCallback } from './commands/edit';
import { handleTest } from './commands/test';
import { handleInfo } from './commands/info';
import { trackGroupMetadata } from './utils/group-tracker';
import type { SessionData } from './utils/session';
import { COMMANDS } from './utils/constants';

type MyContext = Context & SessionFlavor<SessionData> & { env: Env };

export interface Env {
	BOT_TOKEN: string;
	TELEGRAM_BOT_API_SECRET_TOKEN: string;
	ENV: string;
	// Hyperdrive for CockroachDB connection
	HYPERDRIVE: { connectionString: string };
	// Durable Object namespace for grammY sessions
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
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: corsHeaders,
			});
		}

		const url = new URL(request.url);

		// Test endpoint for local development
		if (url.pathname === '/test' && request.method === 'GET') {
			return new Response('Bot is running! Set webhook to: ' + request.url.replace('/test', ''), {
				status: 200,
				headers: corsHeaders,
			});
		}

		// Handle set commands endpoint
		if (url.pathname === '/api/set-commands') {
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
					{ command: COMMANDS.CATEGORY, description: 'Update expense category' },
					{ command: COMMANDS.HELP, description: 'Show all available commands' },
					{ command: COMMANDS.INFO, description: 'Get detailed help for a command' },
				];

				// Set commands for group chats
				await bot.api.setMyCommands(commands, {
					scope: { type: 'all_group_chats' },
				});

				// Set commands for private chats (limited set)
				await bot.api.setMyCommands(
					[
						{ command: COMMANDS.START, description: 'Get started with FinPals' },
						{ command: COMMANDS.ADD, description: 'Add a personal expense' },
						{ command: COMMANDS.EXPENSES, description: 'View your expenses' },
						{ command: COMMANDS.STATS, description: 'View statistics' },
						{ command: COMMANDS.HELP, description: 'Show available commands' },
						{ command: COMMANDS.INFO, description: 'Get detailed help for a command' },
					],
					{
						scope: { type: 'all_private_chats' },
					}
				);

				return new Response(JSON.stringify({ success: true, message: 'Commands set successfully' }), {
					status: 200,
					headers: { ...corsHeaders, 'content-type': 'application/json' },
				});
			} catch (error: any) {
				return new Response(
					JSON.stringify({
						success: false,
						error: error.message || 'Failed to set commands',
					}),
					{
						status: 500,
						headers: { ...corsHeaders, 'content-type': 'application/json' },
					}
				);
			}
		}

		// Handle bot webhook requests (from Telegram)
		try {
			// Initialize bot with token
			const bot = new Bot<MyContext>(env.BOT_TOKEN);

			// Set up session middleware backed by the SessionDO durable object
			setupSession(bot, env);

			// Track group metadata for all messages in groups
			bot.use(async (ctx, next) => {
				ctx.env = env;
				try {
					await trackGroupMetadata(ctx);
				} catch (error) {
					// Silent fail for metadata tracking
				}
				return next();
			});

			// Create single database instance for entire request
			const db = createDb(env);

			// Handle new chat members (when bot is added to group)
			bot.on('chat_member', async (ctx) => {
				if (ctx.chatMember.new_chat_member.status === 'member' && ctx.chatMember.new_chat_member.user.id === ctx.me.id) {
					await handleStart(ctx, db);
				}
			});

			// Handle when bot is added to a group
			bot.on('my_chat_member', async (ctx) => {
				if (ctx.myChatMember.new_chat_member.status === 'member' && ctx.chat.type !== 'private') {
					await handleStart(ctx, db);
				}
			});

			// Set up command handlers
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

			// Handle delete with underscore format (from expenses list)
			bot.hears(/^\/delete_/, (ctx) => handleDelete(ctx, db));
			
			// Handle view expense from search results - simplified callback
			bot.hears(/^\/view_/, async (ctx) => {
				const expenseId = ctx.message?.text?.split('_')[1];
				if (expenseId) {
					await ctx.reply('📊 Use /expenses to view all expenses');
				}
			});

			// Simplified callback handlers - temporarily disabled non-critical features
			
			// Add expense help - simplified
			bot.callbackQuery('add_expense_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'💵 To add an expense, use:\n' +
					'<code>/add [amount] [description]</code>\n\n' +
					'Examples:\n' +
					'• <code>/add 50 dinner</code> - Split with everyone\n' +
					'• <code>/add 30 coffee @john</code> - Split with John',
					{ parse_mode: 'HTML' }
				);
			});

			// View balance callback
			bot.callbackQuery('view_balance', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleBalance(ctx, env);
			});

			// Handle debt simplification
			bot.callbackQuery(/^simplify_debts:(.*)$/, async (ctx) => {
				await ctx.answerCallbackQuery();
				const tripId = ctx.match[1] || undefined;
				const groupId = ctx.chat?.id.toString();
				
				if (!groupId) return;
				
				try {
					// For now, just show the regular balance view
					// Full debt simplification algorithm can be re-implemented later
					await handleBalance(ctx, env);
				} catch (error) {
					await ctx.reply('❌ Error calculating simplified settlements. Showing regular balance instead.');
					await handleBalance(ctx, env);
				}
			});

			// View history callback
			bot.callbackQuery('view_history', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleHistory(ctx, db);
			});

			// View expenses callback
			bot.callbackQuery('view_expenses', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, db);
			});

			// View personal expenses callback
			bot.callbackQuery('view_personal_expenses', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, db);
			});

			// View stats callback
			bot.callbackQuery('view_stats', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleStats(ctx, db);
			});

			// View trends - temporarily disabled
			bot.callbackQuery('view_trends', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('📈 Trends visualization is temporarily disabled during migration.');
			});

			// Settle help callback
			bot.callbackQuery('settle_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'💸 <b>Recording Settlements</b>\n\n' +
						'Use: <code>/settle @username [amount]</code>\n\n' +
						'This records that you paid the mentioned user.\n\n' +
						'Example: <code>/settle @john 25</code>\n' +
						'This means you paid John $25.',
					{ parse_mode: 'HTML' }
				);
			});

			// Handle show settle balances callback
			bot.callbackQuery('show_settle_balances', async (ctx) => {
				await ctx.answerCallbackQuery();
				// Show the balance view which includes settlement suggestions
				await handleBalance(ctx, env);
			});

			// Edit split - future feature
			bot.callbackQuery(/^edit_split:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'✏️ Edit split functionality coming soon!\n\n' +
					'For now, you can delete the expense and create a new one with the correct split.',
					{ parse_mode: 'HTML' }
				);
			});

			// Expense page navigation - simplified
			bot.callbackQuery(/^exp_page:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, db);
			});

			// Expense selection
			bot.callbackQuery(/^exp_select:/, async (ctx) => {
				await handleExpenseSelection(ctx, db);
			});

			// Personal expense page navigation - simplified
			bot.callbackQuery(/^personal_exp_page:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, db);
			});

			// Quick add - simplified
			bot.callbackQuery(/^quick_add:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				const data = ctx.callbackQuery.data.split(':');
				const amount = data[1];
				const description = data[2];
				
				// Create a fake message context for handleAdd
				const fakeCtx = {
					...ctx,
					message: {
						message_id: ctx.callbackQuery.message?.message_id || 0,
						date: ctx.callbackQuery.message?.date || Date.now(),
						chat: ctx.chat!,
						text: `/add ${amount} ${description}`,
						entities: [],
						from: ctx.from
					}
				};
				
				await ctx.deleteMessage();
				await handleAdd(fakeCtx as any, db);
			});

			// Custom expense
			bot.callbackQuery('add_expense_custom', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.deleteMessage();
				
				const isPrivate = ctx.chat?.type === 'private';
				await ctx.reply(
					isPrivate
						? '💵 To add a custom expense, use:\n<code>/add [amount] [description]</code>\n\nExample: <code>/add 25.50 lunch</code>'
						: '💵 To add a custom expense, use:\n<code>/add [amount] [description] [@mentions]</code>\n\nExamples:\n• <code>/add 50 dinner</code> - Split with everyone\n• <code>/add 30 coffee @john</code> - Split with John',
					{ parse_mode: 'HTML' }
				);
			});

			// Close button
			bot.callbackQuery('close', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.deleteMessage();
			});

			// Info list callback
			bot.callbackQuery('info_list', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleInfo(ctx);
			});

			// Search help callback
			bot.callbackQuery('search_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'🔍 <b>Search Help</b>\n\n' +
					'You can search by:\n' +
					'• <b>Text:</b> /search lunch\n' +
					'• <b>Amount:</b> /search >50\n' +
					'• <b>Range:</b> /search 20-100\n' +
					'• <b>Person:</b> /search @john\n' +
					'• <b>Date:</b> /search yesterday\n' +
					'• <b>Combine:</b> /search coffee last week\n\n' +
					'More examples:\n' +
					'• /search dinner >30\n' +
					'• /search @sarah last month\n' +
					'• /search uber 10-50',
					{ parse_mode: 'HTML' }
				);
			});

			// Delete expense callback - simplified
			bot.callbackQuery(/^del:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('Use /delete command to delete expenses');
			});

			// Delete callback from delete command list - simplified
			bot.callbackQuery(/^delete_/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('Use /delete command to delete expenses');
			});

			// Receipt-related callbacks - deprecated
			bot.callbackQuery(/^receipt:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('📷 Receipt functionality is temporarily disabled.');
			});

			bot.callbackQuery('cancel_receipt', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.deleteMessage();
			});

			bot.callbackQuery(/^view_receipt:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('📷 Receipt functionality is temporarily disabled.');
			});

			// Category change callback - simplified
			bot.callbackQuery(/^cat:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('📂 Category updates are temporarily disabled.');
			});

			// Set category callback - simplified
			bot.callbackQuery(/^setcat:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('📂 Category updates are temporarily disabled.');
			});

			// Settle button callback
			bot.callbackQuery(/^settle_/, async (ctx) => {
				await handleSettleCallback(ctx, db);
			});

			// Partial payment callbacks - simplified
			bot.callbackQuery(/^partial_pay_/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('💵 Partial payments are temporarily disabled.');
			});

			// Custom partial payment - simplified
			bot.callbackQuery(/^partial_custom_/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('💵 Custom partial payments are temporarily disabled.');
			});

			// Edit expense callback
			bot.callbackQuery(/^edit:/, async (ctx) => {
				const expenseId = ctx.callbackQuery.data.split(':')[1];
				await handleEditCallback(ctx, db, expenseId);
			});

			// Expense details callback - simplified
			bot.callbackQuery(/^exp:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply('📊 Use /expenses to view expense details');
			});

			// Handle the webhook request
			const response = await webhookCallback(bot, 'cloudflare-mod', {
				secretToken: env.TELEGRAM_BOT_API_SECRET_TOKEN,
			})(request);

			// Add CORS headers to the response
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
			// Return a friendly message for non-webhook requests
			return new Response('FinPals - Telegram Expense Splitting Bot', {
				status: 200,
				headers: { ...corsHeaders, 'content-type': 'text/plain' },
			});
		}
	},
	
	async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
		// Scheduled tasks have been deprecated with the migration to CockroachDB
	},
};

export default worker;

// Export Durable Object for session storage so Workers runtime can instantiate it
export { SessionDO } from './SessionDO';