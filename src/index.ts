import { Bot, Context, SessionFlavor, webhookCallback } from 'grammy';
import { setupSession } from './utils/session';
import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { handleStart } from './commands/start';
import { handleAddEnhanced as handleAdd } from './commands/add-enhanced';
import { handleBalance } from './commands/balance';
import { handleSettle, handleSettleCallback } from './commands/settle';
import { handleStats } from './commands/stats';
import { handleHelp } from './commands/help-enhanced';
import { handleHistory } from './commands/history';
import { handleExpenses, showExpensesPage, handleExpenseSelection } from './commands/expenses';
import { handleDelete } from './commands/delete';
import { handleCategory } from './commands/category';
import { handleExport } from './commands/export';
import { handleSummary } from './commands/summary';
import { handlePersonal } from './commands/personal';
import { handleTrip } from './commands/trip';
import { handleTrips } from './commands/trips';
import { handleTest } from './commands/test';
import { handleBudget } from './commands/budget';
import { handleTemplates, handleQuickAdd } from './commands/templates';
import { trackGroupMetadata } from './utils/group-tracker';
import type { SessionData } from './utils/session';
import { COMMANDS, EXPENSE_CATEGORIES } from './utils/constants';
import { processRecurringReminders } from './utils/recurring-reminders';
import { handleReceiptUpload } from './utils/receipt-ocr';
import { handleVoiceMessage } from './utils/voice-handler';
import { updateExchangeRatesInDB } from './utils/currency';

type MyContext = Context & SessionFlavor<SessionData> & { env: Env };

export interface Env {
	BOT_TOKEN: string;
	TELEGRAM_BOT_API_SECRET_TOKEN: string;
	ENV: string;
	// D1 Database
	DB: D1Database;
	// Durable Object namespace for grammY sessions
	SESSIONS: DurableObjectNamespace;
	// AI binding for OCR
	AI: any;
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
					{ command: COMMANDS.TRIP, description: 'Manage trips for expense tracking' },
					{ command: COMMANDS.TRIPS, description: 'List all trips' },
					{ command: COMMANDS.HISTORY, description: 'View recent transactions' },
					{ command: COMMANDS.STATS, description: 'View group statistics' },
					{ command: COMMANDS.EXPENSES, description: 'List all expenses' },
					{ command: COMMANDS.DELETE, description: 'Delete an expense' },
					{ command: COMMANDS.CATEGORY, description: 'Update expense category' },
					{ command: COMMANDS.EXPORT, description: 'Export data as CSV' },
					{ command: COMMANDS.SUMMARY, description: 'View monthly summary' },
					{ command: COMMANDS.BUDGET, description: 'Manage personal budgets (DM only)' },
					{ command: COMMANDS.TEMPLATES, description: 'Manage expense templates' },
					{ command: COMMANDS.HELP, description: 'Show all available commands' },
				];

				// Set commands for group chats
				await bot.api.setMyCommands(commands, {
					scope: { type: 'all_group_chats' },
				});

				// Set commands for private chats (limited set)
				await bot.api.setMyCommands(
					[
						{ command: COMMANDS.START, description: 'Get started with FinPals' },
						{ command: COMMANDS.BUDGET, description: 'Manage personal budgets' },
						{ command: COMMANDS.PERSONAL, description: 'View cross-group summary' },
						{ command: COMMANDS.HELP, description: 'Show available commands' },
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
				console.error('Error setting commands:', error);
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
					console.error('Error tracking group metadata:', error);
				}
				return next();
			});

			// Handle new chat members (when bot is added to group)
			bot.on('chat_member', async (ctx) => {
				if (ctx.chatMember.new_chat_member.status === 'member' && ctx.chatMember.new_chat_member.user.id === ctx.me.id) {
					await handleStart(ctx);
				}
			});

			// Handle when bot is added to a group
			bot.on('my_chat_member', async (ctx) => {
				if (ctx.myChatMember.new_chat_member.status === 'member' && ctx.chat.type !== 'private') {
					await handleStart(ctx);
				}
			});

			// Set up command handlers
			bot.command(COMMANDS.START, handleStart);
			bot.command(COMMANDS.ADD, (ctx) => handleAdd(ctx, env.DB));
			bot.command(COMMANDS.BALANCE, (ctx) => handleBalance(ctx, env.DB));
			bot.command(COMMANDS.SETTLE, (ctx) => handleSettle(ctx, env.DB));
			bot.command(COMMANDS.HISTORY, (ctx) => handleHistory(ctx, env.DB));
			bot.command(COMMANDS.STATS, (ctx) => handleStats(ctx, env.DB));
			bot.command(COMMANDS.EXPENSES, (ctx) => handleExpenses(ctx, env.DB));
			bot.command(COMMANDS.DELETE, (ctx) => handleDelete(ctx, env.DB));
			bot.command(COMMANDS.CATEGORY, (ctx) => handleCategory(ctx, env.DB));
			bot.command(COMMANDS.EXPORT, (ctx) => handleExport(ctx, env.DB));
			bot.command(COMMANDS.SUMMARY, (ctx) => handleSummary(ctx, env.DB));
			bot.command(COMMANDS.PERSONAL, (ctx) => handlePersonal(ctx, env.DB));
			bot.command(COMMANDS.TRIP, (ctx) => handleTrip(ctx, env.DB));
			bot.command(COMMANDS.TRIPS, (ctx) => handleTrips(ctx, env.DB));
			bot.command(COMMANDS.BUDGET, (ctx) => handleBudget(ctx, env.DB));
			bot.command(COMMANDS.TEMPLATES, (ctx) => handleTemplates(ctx, env.DB));
			bot.command(COMMANDS.HELP, (ctx) => handleHelp(ctx, env.DB));
			bot.command('test', (ctx) => handleTest(ctx));

			// Handle delete with underscore format (from expenses list)
			bot.hears(/^\/delete_/, (ctx) => handleDelete(ctx, env.DB));
			
			// Handle template shortcuts (dynamic commands)
			bot.on('message:text', async (ctx) => {
				const text = ctx.message.text;
				if (text && text.startsWith('/') && !text.includes(' ')) {
					const command = text.substring(1).toLowerCase();
					// Check if it's a known command
					const knownCommands = Object.values(COMMANDS);
					if (!knownCommands.includes(command) && command !== 'test' && !command.startsWith('delete_')) {
						// Might be a template shortcut
						await handleQuickAdd(ctx, env.DB, command);
					}
				}
			});

			// Handle photo messages (receipt OCR)
			bot.on('message:photo', async (ctx) => {
				// Only process in groups or when it's a reply to the bot
				const isGroup = ctx.chat?.type !== 'private';
				const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.me.id;
				
				if (isGroup || isReplyToBot) {
					await handleReceiptUpload(ctx, env.DB, env);
				}
			});

			// Handle voice messages
			bot.on('message:voice', async (ctx) => {
				// Only process in groups or when it's a reply to the bot
				const isGroup = ctx.chat?.type !== 'private';
				const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.me.id;
				
				if (isGroup || isReplyToBot) {
					try {
						await handleVoiceMessage(ctx, env.DB, env);
					} catch (error) {
						console.error('Voice message error:', error);
						await ctx.reply(
							'🎤 Voice message received!\n\n' +
							'⚠️ Voice transcription is currently unavailable.\n\n' +
							'Please type your expense instead:\n' +
							'`/add [amount] [description]`\n\n' +
							'Example: `/add 20 lunch`',
							{ parse_mode: 'Markdown' }
						);
					}
				}
			});

			// Handle callback queries
			bot.callbackQuery('help', (ctx) => handleHelp(ctx, env.DB));
			bot.callbackQuery('add_expense_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				const isPrivate = ctx.chat?.type === 'private';
				
				if (isPrivate) {
					await ctx.reply(
						'💵 <b>Adding Personal Expenses</b>\n\n' +
							'Use: <code>/add [amount] [description]</code>\n\n' +
							'Examples:\n' +
							'• <code>/add 50 groceries</code> - Track grocery expense\n' +
							'• <code>/add 30.50 coffee</code> - Track coffee expense\n' +
							'• <code>/add 120 dinner out</code> - Track restaurant expense\n\n' +
							'Expenses are private and only visible to you. They will be automatically categorized!',
						{ parse_mode: 'HTML' }
					);
				} else {
					await ctx.reply(
						'💵 <b>Adding Expenses</b>\n\n' +
							'Use: <code>/add [amount] [description] [@mentions]</code>\n\n' +
							'Examples:\n' +
							'• <code>/add 50 dinner</code> - Split $50 dinner with everyone\n' +
							'• <code>/add 120 uber @john @sarah</code> - Split $120 uber with John and Sarah\n' +
							'• <code>/add 30.50 coffee @mike</code> - Split $30.50 coffee with Mike\n\n' +
							"If you don't mention anyone, the expense will be split between all active group members.",
						{ parse_mode: 'HTML' }
					);
				}
			});

			bot.callbackQuery('budget_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'💰 <b>Budget Management</b>\n\n' +
						'Use: <code>/budget</code> to manage your budgets\n\n' +
						'<b>Set a budget:</b>\n' +
						'<code>/budget set "Food & Dining" 500 monthly</code>\n' +
						'<code>/budget set "Transportation" 100 weekly</code>\n\n' +
						'<b>View budgets:</b>\n' +
						'<code>/budget view</code>\n\n' +
						'<b>Delete a budget:</b>\n' +
						'<code>/budget delete "Food & Dining"</code>\n\n' +
						'You\'ll get alerts when approaching budget limits!',
					{ parse_mode: 'HTML' }
				);
			});

			bot.callbackQuery('view_balance', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleBalance(ctx, env.DB);
			});

			bot.callbackQuery('view_history', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleHistory(ctx, env.DB);
			});

			bot.callbackQuery('view_expenses', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, env.DB);
			});

			bot.callbackQuery('view_personal_expenses', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, env.DB);
			});

			bot.callbackQuery('view_stats', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleStats(ctx, env.DB);
			});

			bot.callbackQuery('view_trends', async (ctx) => {
				await ctx.answerCallbackQuery();
				const groupId = ctx.chat?.id.toString();
				if (!groupId) return;
				
				try {
					const { generateSpendingTrends, formatTrendsMessage } = await import('./utils/spending-visualization');
					const { trends, categoryTrends, insights } = await generateSpendingTrends(env.DB, groupId);
					const trendsMessage = formatTrendsMessage(trends, categoryTrends, insights);
					
					await ctx.reply(trendsMessage, { 
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[{ text: '📊 Back to Stats', callback_data: 'view_stats' }],
								[{ text: '❌ Close', callback_data: 'close' }]
							]
						}
					});
				} catch (error) {
					console.error('Error getting trends:', error);
					await ctx.reply('❌ Error loading trends. Please try again.');
				}
			});

			bot.callbackQuery('export_csv', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExport(ctx, env.DB);
			});

			bot.callbackQuery('personal_monthly', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleSummary(ctx, env.DB);
			});

			bot.callbackQuery('budget_set_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'📝 <b>Setting a Budget</b>\n\n' +
					'Use: <code>/budget set [category] [amount] [period]</code>\n\n' +
					'<b>Categories:</b>\n' +
					'• Food & Dining\n' +
					'• Transportation\n' +
					'• Entertainment\n' +
					'• Shopping\n' +
					'• Bills & Utilities\n' +
					'• And more...\n\n' +
					'<b>Periods:</b> daily, weekly, monthly\n\n' +
					'<b>Examples:</b>\n' +
					'<code>/budget set "Food & Dining" 500 monthly</code>\n' +
					'<code>/budget set Transportation 50 daily</code>',
					{ parse_mode: 'HTML' }
				);
			});

			bot.callbackQuery('spending_report', async (ctx) => {
				await ctx.answerCallbackQuery();
				const userId = ctx.from.id.toString();
				
				try {
					const { getBudgetsWithSpending } = await import('./utils/budget-helpers');
					const { formatCurrency } = await import('./utils/currency');
					const budgets = await getBudgetsWithSpending(env.DB, userId);
					
					if (!budgets || budgets.length === 0) {
						await ctx.reply('📊 No budget data available. Set up budgets first!');
						return;
					}
					
					let message = '📊 <b>Spending Report</b>\n\n';
					
					for (const budget of budgets) {
						const emoji = budget.percentage >= 100 ? '🔴' : budget.percentage >= 80 ? '🟡' : '🟢';
						const remaining = Math.max(0, budget.amount - budget.spent);
						
						message += `${emoji} <b>${budget.category}</b>\n`;
						message += `   Budget: ${formatCurrency(budget.amount, budget.currency)} ${budget.period}\n`;
						message += `   Spent: ${formatCurrency(budget.spent, budget.currency)} (${budget.percentage}%)\n`;
						message += `   Remaining: ${formatCurrency(remaining, budget.currency)}\n\n`;
					}
					
					await ctx.reply(message, { 
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[{ text: '💰 Budget Menu', callback_data: 'budget_menu' }],
								[{ text: '❌ Close', callback_data: 'close' }]
							]
						}
					});
				} catch (error) {
					console.error('Error generating spending report:', error);
					await ctx.reply('❌ Error generating report. Please try again.');
				}
			});

			bot.callbackQuery('budget_menu', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleBudget(ctx, env.DB);
			});

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
				const { showUnsettledBalances } = await import('./commands/settle');
				await showUnsettledBalances(ctx, env.DB);
			});

			// Handle edit split callback (for future implementation)
			bot.callbackQuery(/^edit_split:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'✏️ Edit split functionality coming soon!\n\n' +
					'For now, you can delete the expense and create a new one with the correct split.',
					{ parse_mode: 'HTML' }
				);
			});

			// Handle expense page navigation
			bot.callbackQuery(/^exp_page:/, async (ctx) => {
				const page = parseInt(ctx.callbackQuery.data.split(':')[1]);
				const groupId = ctx.chat?.id.toString();

				try {
					// Get all expenses
					const expenses = await env.DB.prepare(`
						SELECT 
							e.id,
							e.amount,
							e.currency,
							e.description,
							e.category,
							e.created_at,
							e.created_by,
							u.username as payer_username,
							u.first_name as payer_first_name,
							(SELECT COUNT(*) FROM expense_splits WHERE expense_id = e.id) as split_count
						FROM expenses e
						JOIN users u ON e.paid_by = u.telegram_id
						WHERE e.group_id = ? AND e.deleted = FALSE
						ORDER BY e.created_at DESC
					`).bind(groupId).all();

					await ctx.answerCallbackQuery();
					await showExpensesPage(ctx, expenses.results || [], page);
				} catch (error) {
					console.error('Error navigating expenses:', error);
					await ctx.answerCallbackQuery('Error loading expenses');
				}
			});

			// Handle expense selection
			bot.callbackQuery(/^exp_select:/, async (ctx) => {
				await handleExpenseSelection(ctx, env.DB);
			});

			// Handle personal expense page navigation
			bot.callbackQuery(/^personal_exp_page:/, async (ctx) => {
				const page = parseInt(ctx.callbackQuery.data.split(':')[1]);
				const userId = ctx.from?.id.toString();

				try {
					// Get all personal expenses
					const expenses = await env.DB.prepare(`
						SELECT 
							e.id,
							e.amount,
							e.currency,
							e.description,
							e.category,
							e.created_at
						FROM expenses e
						WHERE e.paid_by = ? AND e.is_personal = TRUE AND e.deleted = FALSE
						ORDER BY e.created_at DESC
					`).bind(userId).all();

					await ctx.answerCallbackQuery();
					const { showPersonalExpensesPage } = await import('./commands/expenses');
					await showPersonalExpensesPage(ctx, expenses.results || [], page);
				} catch (error) {
					console.error('Error navigating personal expenses:', error);
					await ctx.answerCallbackQuery('Error loading expenses');
				}
			});

			// Handle close button
			bot.callbackQuery('close', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.deleteMessage();
			});

			// Handle trip-related callbacks
			bot.callbackQuery('start_trip_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'🏝 <b>Starting a Trip</b>\n\n' +
					'Use: <code>/trip start [name]</code>\n\n' +
					'Example: /trip start Weekend Getaway\n\n' +
					'All expenses added after starting a trip will be linked to it!',
					{ parse_mode: 'HTML' }
				);
			});

			bot.callbackQuery('confirm_end_trip', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.reply(
					'⚠️ <b>End Current Trip?</b>\n\n' +
					'This will end the active trip. Future expenses won\'t be linked to it.\n\n' +
					'Use: /trip end',
					{ parse_mode: 'HTML' }
				);
			});

			bot.callbackQuery(/^trip_balance_/, async (ctx) => {
				const tripId = ctx.callbackQuery.data.split('_')[2];
				await ctx.answerCallbackQuery();
				await handleBalance(ctx, env.DB, tripId);
			});

			bot.callbackQuery(/^trip_summary_/, async (ctx) => {
				const tripId = ctx.callbackQuery.data.split('_')[2];
				await ctx.answerCallbackQuery();
				// For now, show trip expenses
				const groupId = ctx.chat?.id.toString();
				if (!groupId) return;

				const expenses = await env.DB.prepare(`
					SELECT 
						e.*,
						u.username,
						u.first_name
					FROM expenses e
					JOIN users u ON e.paid_by = u.telegram_id
					WHERE e.trip_id = ? AND e.deleted = FALSE
					ORDER BY e.created_at DESC
				`).bind(tripId).all();

				await showExpensesPage(ctx, expenses.results || [], 0);
			});

			// Handle delete expense callback
			bot.callbackQuery(/^del:/, async (ctx) => {
				const parts = ctx.callbackQuery.data.split(':');
				const expenseId = parts[1];
				const returnPage = parts[2] ? parseInt(parts[2]) : null;
				const groupId = ctx.chat?.id.toString();
				const userId = ctx.from.id.toString();

				try {
					// Check if expense exists and user has permission
					const expense = await env.DB.prepare(`
						SELECT 
							e.id, 
							e.description, 
							e.amount,
							e.created_by
						FROM expenses e
						WHERE e.id = ? AND e.group_id = ? AND e.deleted = FALSE
					`).bind(expenseId, groupId).first();

					if (!expense) {
						await ctx.answerCallbackQuery('Expense not found or already deleted');
						return;
					}

					// Check permissions
					const isCreator = expense.created_by === userId;
					let isAdmin = false;
					try {
						const member = await ctx.getChatMember(parseInt(userId));
						isAdmin = member.status === 'administrator' || member.status === 'creator';
					} catch {
						// Ignore permission check errors
					}

					if (!isCreator && !isAdmin) {
						await ctx.answerCallbackQuery('You can only delete expenses you created');
						return;
					}

					// Delete the expense
					await env.DB.prepare(
						'UPDATE expenses SET deleted = TRUE WHERE id = ?'
					).bind(expenseId).run();

					await ctx.answerCallbackQuery('Expense deleted successfully');
					
					// If we have a return page, go back to the expenses list
					if (returnPage !== null) {
						// Get updated expenses
						const expenses = await env.DB.prepare(`
							SELECT 
								e.id,
								e.amount,
								e.currency,
								e.description,
								e.category,
								e.created_at,
								e.created_by,
								u.username as payer_username,
								u.first_name as payer_first_name,
								(SELECT COUNT(*) FROM expense_splits WHERE expense_id = e.id) as split_count
							FROM expenses e
							JOIN users u ON e.paid_by = u.telegram_id
							WHERE e.group_id = ? AND e.deleted = FALSE
							ORDER BY e.created_at DESC
						`).bind(groupId).all();

						await showExpensesPage(ctx, expenses.results || [], returnPage);
					} else {
						// Just update the message
						await ctx.editMessageText(
							`❌ <b>Deleted:</b> ${expense.description} - $${(expense.amount as number).toFixed(2)}`,
							{ parse_mode: 'HTML' }
						);
					}
				} catch (error) {
					console.error('Error deleting expense:', error);
					await ctx.answerCallbackQuery('Error deleting expense');
				}
			});

			// Handle delete callback from delete command list
			bot.callbackQuery(/^delete_/, async (ctx) => {
				await ctx.answerCallbackQuery();
				
				const expenseId = ctx.callbackQuery.data.split('_')[1];
				const groupId = ctx.chat!.id.toString();
				const userId = ctx.from.id.toString();

				try {
					// Check if expense exists and user has permission to delete
					const expense = await env.DB.prepare(`
						SELECT 
							e.id, 
							e.description, 
							e.amount,
							e.created_by,
							u.username,
							u.first_name
						FROM expenses e
						JOIN users u ON e.created_by = u.telegram_id
						WHERE e.id = ? AND e.group_id = ? AND e.deleted = FALSE
					`).bind(expenseId, groupId).first();

					if (!expense) {
						await ctx.editMessageText('❌ Expense not found or already deleted.');
						return;
					}

					// Only allow creator or admins to delete
					const isCreator = expense.created_by === userId;
					let isAdmin = false;

					try {
						const member = await ctx.getChatMember(parseInt(userId));
						isAdmin = member.status === 'administrator' || member.status === 'creator';
					} catch {
						// Ignore permission check errors
					}

					if (!isCreator && !isAdmin) {
						const creatorName = expense.username || expense.first_name || 'Unknown';
						await ctx.answerCallbackQuery();
						await ctx.editMessageText(
							`❌ Only @${creatorName} or admins can delete this expense`
						);
						return;
					}

					// Soft delete the expense
					await env.DB.prepare(
						'UPDATE expenses SET deleted = TRUE WHERE id = ?'
					).bind(expenseId).run();

					await ctx.editMessageText(
						`✅ <b>Expense Deleted</b>\n\n` +
						`"${expense.description}" - $${(expense.amount as number).toFixed(2)}\n\n` +
						`The balances have been updated.`,
						{
							parse_mode: 'HTML',
							reply_markup: {
								inline_keyboard: [
									[{ text: '📊 View Balance', callback_data: 'view_balance' }],
									[{ text: '📜 View History', callback_data: 'view_history' }]
								]
							}
						}
					);
				} catch (error) {
					console.error('Error deleting expense:', error);
					await ctx.answerCallbackQuery('Error deleting expense');
				}
			});

			// Handle category change callback
			bot.callbackQuery(/^cat:/, async (ctx) => {
				const parts = ctx.callbackQuery.data.split(':');
				const expenseId = parts[1];
				const returnPage = parts[2] ? parseInt(parts[2]) : null;
				await ctx.answerCallbackQuery();

				const categories = EXPENSE_CATEGORIES.map((cat, i) => {
					const callbackData = returnPage !== null 
						? `setcat:${expenseId}:${i}:${returnPage}`
						: `setcat:${expenseId}:${i}`;
					return [{ text: cat, callback_data: callbackData }];
				});

				// Add cancel button
				categories.push([{ 
					text: '❌ Cancel', 
					callback_data: returnPage !== null ? `exp_page:${returnPage}` : 'close' 
				}]);

				await ctx.editMessageText(
					'📂 <b>Select a category:</b>',
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: categories
						}
					}
				);
			});

			// Handle set category callback
			bot.callbackQuery(/^setcat:/, async (ctx) => {
				const parts = ctx.callbackQuery.data.split(':');
				const expenseId = parts[1];
				const categoryIndex = parseInt(parts[2]);
				const returnPage = parts[3] ? parseInt(parts[3]) : null;
				const category = EXPENSE_CATEGORIES[categoryIndex];
				const groupId = ctx.chat?.id.toString();

				try {
					// Get expense details
					const expense = await env.DB.prepare(`
						SELECT description, amount 
						FROM expenses 
						WHERE id = ? AND group_id = ? AND deleted = FALSE
					`).bind(expenseId, groupId).first();

					if (!expense) {
						await ctx.answerCallbackQuery('Expense not found');
						return;
					}

					// Update category
					await env.DB.prepare(
						'UPDATE expenses SET category = ? WHERE id = ?'
					).bind(category, expenseId).run();

					// Update category mapping for AI
					await env.DB.prepare(`
						INSERT INTO category_mappings (description_pattern, category, confidence)
						VALUES (?, ?, 1.0)
						ON CONFLICT(description_pattern) DO UPDATE SET
							category = excluded.category,
							usage_count = usage_count + 1,
							confidence = MIN(1.0, confidence + 0.1)
					`).bind(expense.description?.toString().toLowerCase() || '', category).run();

					await ctx.answerCallbackQuery(`Category updated to ${category}`);
					
					// If we have a return page, go back to the expenses list
					if (returnPage !== null) {
						// Get updated expenses
						const expenses = await env.DB.prepare(`
							SELECT 
								e.id,
								e.amount,
								e.currency,
								e.description,
								e.category,
								e.created_at,
								e.created_by,
								u.username as payer_username,
								u.first_name as payer_first_name,
								(SELECT COUNT(*) FROM expense_splits WHERE expense_id = e.id) as split_count
							FROM expenses e
							JOIN users u ON e.paid_by = u.telegram_id
							WHERE e.group_id = ? AND e.deleted = FALSE
							ORDER BY e.created_at DESC
						`).bind(groupId).all();

						await showExpensesPage(ctx, expenses.results || [], returnPage);
					} else {
						// Just delete the message
						await ctx.deleteMessage();
					}
				} catch (error) {
					console.error('Error updating category:', error);
					await ctx.answerCallbackQuery('Error updating category');
				}
			});

			// Handle add recurring expense callback
			bot.callbackQuery(/^add_recurring:/, async (ctx) => {
				const [_, description, amount] = ctx.callbackQuery.data.split(':');
				await ctx.answerCallbackQuery();
				
				// Simulate add command with the recurring expense
				const messageText = `/add ${amount} ${description}`;
				// Create a new context with the simulated message
				const newMessage = Object.assign({}, ctx.message || {}, {
					text: messageText
				});
				const newCtx = Object.assign({}, ctx, {
					message: newMessage
				});
				await handleAdd(newCtx, env.DB);
			});

			// Handle dismiss reminder callback
			bot.callbackQuery('dismiss_reminder', async (ctx) => {
				await ctx.answerCallbackQuery('Reminder dismissed');
				await ctx.deleteMessage();
			});

			// Handle voice confirmation callbacks
			bot.callbackQuery(/^voice_confirm:/, async (ctx) => {
				const [_, amount, ...descParts] = ctx.callbackQuery.data.split(':');
				const description = descParts.join(':'); // In case description contains colons
				await ctx.answerCallbackQuery();
				
				// Create a simulated add command
				const messageText = `/add ${amount} ${description}`;
				const newMessage = Object.assign({}, ctx.message || {}, {
					text: messageText
				});
				const newCtx = Object.assign({}, ctx, {
					message: newMessage
				});
				
				await ctx.editMessageText('✅ Adding expense from voice message...');
				await handleAdd(newCtx, env.DB);
			});

			bot.callbackQuery('voice_cancel', async (ctx) => {
				await ctx.answerCallbackQuery('Voice expense cancelled');
				await ctx.deleteMessage();
			});

			// Handle dismiss budget alert callback
			bot.callbackQuery('dismiss_budget_alert', async (ctx) => {
				await ctx.answerCallbackQuery('Budget alert dismissed');
				await ctx.deleteMessage();
			});

			// Handle settle button callback
			bot.callbackQuery(/^settle_/, async (ctx) => {
				await handleSettleCallback(ctx, env.DB);
			});

			// Handle expense details callback
			bot.callbackQuery(/^exp:/, async (ctx) => {
				const expenseId = ctx.callbackQuery.data.split(':')[1];
				const groupId = ctx.chat?.id.toString();

				try {
					// Get expense with full details
					const expense = await env.DB.prepare(`
						SELECT 
							e.*,
							u.username as payer_username,
							u.first_name as payer_first_name
						FROM expenses e
						JOIN users u ON e.paid_by = u.telegram_id
						WHERE e.id = ? AND e.group_id = ? AND e.deleted = FALSE
					`).bind(expenseId, groupId).first();

					if (!expense) {
						await ctx.answerCallbackQuery('Expense not found');
						return;
					}

					// Get splits
					const splits = await env.DB.prepare(`
						SELECT 
							es.amount,
							u.username,
							u.first_name
						FROM expense_splits es
						JOIN users u ON es.user_id = u.telegram_id
						WHERE es.expense_id = ?
					`).bind(expenseId).all();

					const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
					const splitDetails = splits.results.map(s => 
						`  • @${s.username || s.first_name || 'Unknown'}: $${(s.amount as number).toFixed(2)}`
					).join('\n');

					const details = 
						`📊 <b>Expense Details</b>\n\n` +
						`<b>Description:</b> ${expense.description}\n` +
						`<b>Total Amount:</b> $${(expense.amount as number).toFixed(2)}\n` +
						`<b>Paid by:</b> @${payerName}\n` +
						`<b>Category:</b> ${expense.category || 'Uncategorized'}\n` +
						`<b>Date:</b> ${new Date(expense.created_at as string).toLocaleString()}\n\n` +
						`<b>Split between:</b>\n${splitDetails}`;

					await ctx.answerCallbackQuery();
					await ctx.reply(details, { parse_mode: 'HTML' });
				} catch (error) {
					console.error('Error getting expense details:', error);
					await ctx.answerCallbackQuery('Error loading details');
				}
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
			console.error('Error in bot:', error);
			// Return a friendly message for non-webhook requests
			return new Response('FinPals - Telegram Expense Splitting Bot', {
				status: 200,
				headers: { ...corsHeaders, 'content-type': 'text/plain' },
			});
		}
	},
	
	async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		try {
			// Update exchange rates every 12 hours
			const now = new Date();
			const hour = now.getUTCHours();
			
			// Update rates at 9 AM and 9 PM UTC
			if (hour === 9 || hour === 21) {
				console.log('Updating exchange rates...');
				const updated = await updateExchangeRatesInDB(env.DB);
				if (updated) {
					console.log('Exchange rates updated successfully');
				} else {
					console.error('Failed to update exchange rates');
				}
			}
			
			// Process recurring expense reminders (runs every cron trigger)
			const bot = new Bot<MyContext>(env.BOT_TOKEN);
			const stats = await processRecurringReminders(env.DB, bot);
			console.log(`Recurring reminders processed: ${stats.sent} sent, ${stats.errors} errors`);
		} catch (error) {
			console.error('Error in scheduled handler:', error);
		}
	},
};

export default worker;

// Export Durable Object for session storage so Workers runtime can instantiate it
export { SessionDO } from './SessionDO';
