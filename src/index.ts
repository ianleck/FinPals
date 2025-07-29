import { Bot, Context, SessionFlavor, webhookCallback } from 'grammy';
import { setupSession } from './utils/session';
import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { handleStart } from './commands/start';
import { handleAdd } from './commands/add';
import { handleBalance } from './commands/balance';
import { handleSettle, handleSettleCallback } from './commands/settle';
import { handleStats } from './commands/stats';
import { handleHelp } from './commands/help-enhanced';
import { handleHistory } from './commands/history';
import { handleExpenses, showExpensesPage, handleExpenseSelection } from './commands/expenses';
import { handleDelete } from './commands/delete';
import { handleCategory } from './commands/category';
import { handleEdit, handleEditCallback } from './commands/edit';
import { handleExport } from './commands/export';
import { handleSummary } from './commands/summary';
import { handlePersonal } from './commands/personal';
import { handleTrip } from './commands/trip';
import { handleTrips } from './commands/trips';
import { handleTest } from './commands/test';
import { handleBudget } from './commands/budget';
import { handleTemplates, handleQuickAdd } from './commands/templates';
import { handleStatus, handleEnrollAll } from './commands/status';
import { handleRecurring, handleRecurringCallbacks } from './commands/recurring';
import { handleActivity } from './commands/activity';
import { handleFriend, handleFriendActivity } from './commands/friend';
import { handleInfo } from './commands/info';
import { handleFixDuplicates } from './commands/fix-duplicates';
import { trackGroupMetadata } from './utils/group-tracker';
import type { SessionData } from './utils/session';
import { COMMANDS, EXPENSE_CATEGORIES } from './utils/constants';
import { processRecurringReminders } from './utils/recurring-reminders';
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
					{ command: COMMANDS.EDIT, description: 'Edit an expense' },
					{ command: COMMANDS.DELETE, description: 'Delete an expense' },
					{ command: COMMANDS.CATEGORY, description: 'Update expense category' },
					{ command: COMMANDS.EXPORT, description: 'Export data as CSV' },
					{ command: COMMANDS.SUMMARY, description: 'View monthly summary' },
					{ command: COMMANDS.BUDGET, description: 'Manage personal budgets (DM only)' },
					{ command: COMMANDS.TEMPLATES, description: 'Manage expense templates' },
					{ command: COMMANDS.RECURRING, description: 'Manage recurring expenses' },
					{ command: COMMANDS.STATUS, description: 'Show group enrollment status' },
					{ command: COMMANDS.ACTIVITY, description: 'View recent activity feed' },
					{ command: COMMANDS.FRIEND, description: 'View expenses with a specific person' },
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
						{ command: COMMANDS.BUDGET, description: 'Manage personal budgets' },
						{ command: COMMANDS.PERSONAL, description: 'View cross-group summary' },
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
			bot.command(COMMANDS.EDIT, (ctx) => handleEdit(ctx, env.DB));
			bot.command(COMMANDS.DELETE, (ctx) => handleDelete(ctx, env.DB));
			bot.command(COMMANDS.CATEGORY, (ctx) => handleCategory(ctx, env.DB));
			bot.command(COMMANDS.EXPORT, (ctx) => handleExport(ctx, env.DB));
			bot.command(COMMANDS.SUMMARY, (ctx) => handleSummary(ctx, env.DB));
			bot.command(COMMANDS.PERSONAL, (ctx) => handlePersonal(ctx, env.DB));
			bot.command(COMMANDS.TRIP, (ctx) => handleTrip(ctx, env.DB));
			bot.command(COMMANDS.TRIPS, (ctx) => handleTrips(ctx, env.DB));
			bot.command(COMMANDS.BUDGET, (ctx) => handleBudget(ctx, env.DB));
			bot.command(COMMANDS.TEMPLATES, (ctx) => handleTemplates(ctx, env.DB));
			bot.command(COMMANDS.RECURRING, (ctx) => handleRecurring(ctx, env.DB));
			bot.command(COMMANDS.STATUS, (ctx) => handleStatus(ctx, env.DB));
			bot.command(COMMANDS.ENROLL_ALL, (ctx) => handleEnrollAll(ctx, env.DB));
			bot.command(COMMANDS.ACTIVITY, (ctx) => handleActivity(ctx, env.DB));
			bot.command(COMMANDS.FRIEND, (ctx) => handleFriend(ctx, env.DB));
			bot.command(COMMANDS.HELP, (ctx) => handleHelp(ctx, env.DB));
			bot.command(COMMANDS.INFO, (ctx) => handleInfo(ctx));
			bot.command(COMMANDS.FIX_DUPLICATES, (ctx) => handleFixDuplicates(ctx, env.DB));
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


			// Handle callback queries
			bot.callbackQuery('help', (ctx) => handleHelp(ctx, env.DB));
			bot.callbackQuery('add_expense_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				const isPrivate = ctx.chat?.type === 'private';
				const userId = ctx.from?.id.toString();
				const groupId = ctx.chat?.id.toString();
				
				// Get recent expenses to suggest
				let recentExpenses: any[] = [];
				if (userId) {
					try {
						const query = isPrivate
							? `SELECT DISTINCT description, amount, category 
							   FROM expenses 
							   WHERE created_by = ? AND is_personal = TRUE 
							   ORDER BY created_at DESC 
							   LIMIT 3`
							: `SELECT DISTINCT e.description, e.amount, e.category
							   FROM expenses e
							   WHERE e.group_id = ? AND e.created_by = ? AND e.deleted = FALSE
							   ORDER BY e.created_at DESC
							   LIMIT 3`;
						
						const result = await env.DB
							.prepare(query)
							.bind(isPrivate ? userId : groupId, isPrivate ? undefined : userId)
							.all();
						
						recentExpenses = result.results || [];
					} catch (error) {
						console.error('Error fetching recent expenses:', error);
					}
				}
				
				// Build quick add interface
				let message = '💵 <b>Quick Add Expense</b>\n\n';
				
				// Common amounts buttons
				const commonAmounts = isPrivate
					? [
						[{ text: '☕ $5 Coffee', callback_data: 'quick_add:5:coffee' }],
						[{ text: '🍽️ $15 Lunch', callback_data: 'quick_add:15:lunch' }],
						[{ text: '🛒 $50 Groceries', callback_data: 'quick_add:50:groceries' }],
					]
					: [
						[{ text: '☕ $10 Coffee', callback_data: 'quick_add:10:coffee:split' }],
						[{ text: '🍽️ $60 Lunch', callback_data: 'quick_add:60:lunch:split' }],
						[{ text: '🚕 $30 Uber', callback_data: 'quick_add:30:uber:split' }],
					];
				
				// Recent expenses if any
				const recentButtons = recentExpenses.slice(0, 2).map(exp => [{
					text: `↻ $${exp.amount} ${exp.description}`,
					callback_data: `quick_add:${exp.amount}:${exp.description.substring(0, 20)}:${isPrivate ? 'personal' : 'split'}`
				}]);
				
				const keyboard = [
					...commonAmounts,
					...recentButtons,
					[{ text: '📝 Custom Expense', callback_data: 'add_expense_custom' }],
					[{ text: '❌ Cancel', callback_data: 'close' }]
				];
				
				if (recentExpenses.length > 0) {
					message += '<b>Recent:</b>\n';
					recentExpenses.forEach(exp => {
						message += `• $${exp.amount} - ${exp.description}\n`;
					});
					message += '\n';
				}
				
				message += isPrivate
					? 'Choose a quick expense or create custom:'
					: 'Choose a quick expense to split with everyone:';
				
				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: { inline_keyboard: keyboard }
				});
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

			// Handle debt simplification
			bot.callbackQuery(/^simplify_debts:(.*)$/, async (ctx) => {
				await ctx.answerCallbackQuery();
				const tripId = ctx.match[1] || undefined;
				const groupId = ctx.chat?.id.toString();
				
				if (!groupId) return;
				
				try {
					const { getSimplifiedSettlementPlan } = await import('./utils/debt-simplification');
					const { transactions, message } = await getSimplifiedSettlementPlan(env.DB, groupId, tripId);
					
					const buttons = [];
					if (transactions.length > 0) {
						buttons.push([{ text: '💸 Start Settling', callback_data: 'show_settle_balances' }]);
					}
					buttons.push([{ text: '◀️ Back to Balance', callback_data: 'view_balance' }]);
					
					await ctx.reply(message, { 
						parse_mode: 'HTML',
						reply_markup: { inline_keyboard: buttons }
					});
				} catch (error) {
					console.error('Error simplifying debts:', error);
					await ctx.reply('❌ Error calculating simplified settlements.');
				}
			});

			bot.callbackQuery('view_history', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleHistory(ctx, env.DB);
			});

			bot.callbackQuery('view_activity', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleActivity(ctx, env.DB);
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

			// Handle quick add
			bot.callbackQuery(/^quick_add:/, async (ctx) => {
				await ctx.answerCallbackQuery();
				const data = ctx.callbackQuery.data.split(':');
				const amount = data[1];
				const description = data[2];
				const type = data[3]; // 'personal' or 'split'
				
				// Execute the add command
				const command = type === 'personal' || ctx.chat?.type === 'private'
					? `/add ${amount} ${description}`
					: `/add ${amount} ${description}`;
				
				// Create a fake message context for handleAdd
				const fakeCtx = {
					...ctx,
					message: {
						message_id: ctx.callbackQuery.message?.message_id || 0,
						date: ctx.callbackQuery.message?.date || Date.now(),
						chat: ctx.chat!,
						text: command,
						entities: [],
						from: ctx.from
					}
				};
				
				// Delete the quick add menu
				await ctx.deleteMessage();
				
				// Process the expense
				await handleAdd(fakeCtx as any, env.DB);
			});

			// Handle custom expense
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

			// Handle close button
			bot.callbackQuery('close', async (ctx) => {
				await ctx.answerCallbackQuery();
				await ctx.deleteMessage();
			});

			// Handle info list callback
			bot.callbackQuery('info_list', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleInfo(ctx);
			});

			// Handle friend-related callbacks
			bot.callbackQuery(/^friend_activity_/, async (ctx) => {
				const friendId = ctx.callbackQuery.data.split('_')[2];
				await ctx.answerCallbackQuery();
				await handleFriendActivity(ctx, env.DB, friendId);
			});

			bot.callbackQuery(/^friend_view_/, async (ctx) => {
				// Note: friendId is available but handleFriend currently parses from message text
				// This callback is used for navigation back from friend activity view
				await ctx.answerCallbackQuery();
				await ctx.reply('Use /friend @username to view friend details');
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

					// Update category mapping for learning
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


			// Handle dismiss budget alert callback
			bot.callbackQuery('dismiss_budget_alert', async (ctx) => {
				await ctx.answerCallbackQuery('Budget alert dismissed');
				await ctx.deleteMessage();
			});

			// Handle settle button callback
			bot.callbackQuery(/^settle_/, async (ctx) => {
				await handleSettleCallback(ctx, env.DB);
			});

			// Handle partial payment callbacks
			bot.callbackQuery(/^partial_pay_/, async (ctx) => {
				const parts = ctx.callbackQuery.data.split('_');
				let owerId: string, owedId: string, amount: number;
				
				if (parts.length === 4) {
					// From partial settlement command: partial_pay_{toUserId}_{amount}
					owedId = parts[2];
					owerId = ctx.from!.id.toString();
					amount = parseFloat(parts[3]);
				} else {
					// From balance view: partial_pay_{owerId}_{owedId}_{amount}
					owerId = parts[2];
					owedId = parts[3];
					amount = parseFloat(parts[4]);
				}
				
				const groupId = ctx.chat?.id.toString();
				if (!groupId) return;
				
				await ctx.answerCallbackQuery();
				
				// Record the partial settlement
				const settlementId = crypto.randomUUID();
				await env.DB.prepare(
					'INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_by) VALUES (?, ?, ?, ?, ?, ?)'
				).bind(settlementId, groupId, owerId, owedId, amount, ctx.from!.id.toString()).run();
				
				// Get usernames
				const users = await env.DB.prepare(`
					SELECT telegram_id, username, first_name
					FROM users
					WHERE telegram_id IN (?, ?)
				`).bind(owerId, owedId).all();
				
				const owerUser = users.results.find(u => u.telegram_id === owerId);
				const owedUser = users.results.find(u => u.telegram_id === owedId);
				
				const owerName = owerUser?.username || owerUser?.first_name || 'User';
				const owedName = owedUser?.username || owedUser?.first_name || 'User';
				
				// Get remaining balance
				const remainingBalance = await env.DB.prepare(`
					WITH expense_balances AS (
						SELECT 
							e.paid_by as creditor,
							es.user_id as debtor,
							SUM(es.amount) as amount
						FROM expenses e
						JOIN expense_splits es ON e.id = es.expense_id
						WHERE e.group_id = ? AND e.deleted = FALSE
							AND ((e.paid_by = ? AND es.user_id = ?) OR (e.paid_by = ? AND es.user_id = ?))
						GROUP BY e.paid_by, es.user_id
					),
					settlement_balances AS (
						SELECT 
							to_user as creditor,
							from_user as debtor,
							SUM(amount) as amount
						FROM settlements
						WHERE group_id = ?
							AND ((to_user = ? AND from_user = ?) OR (to_user = ? AND from_user = ?))
						GROUP BY to_user, from_user
					)
					SELECT 
						SUM(CASE 
							WHEN creditor = ? AND debtor = ? THEN amount
							WHEN creditor = ? AND debtor = ? THEN -amount
							ELSE 0
						END) as net_balance
					FROM (
						SELECT creditor, debtor, amount FROM expense_balances
						UNION ALL
						SELECT creditor, debtor, -amount FROM settlement_balances
					)
				`).bind(
					groupId, owerId, owedId, owedId, owerId,
					groupId, owerId, owedId, owedId, owerId,
					owedId, owerId, owerId, owedId
				).first();
				
				const remaining = Math.abs(remainingBalance?.net_balance as number || 0);
				
				let message = `💵 <b>Partial Payment Recorded</b>\n\n`;
				message += `@${owerName} paid @${owedName}: <b>$${amount.toFixed(2)}</b>\n\n`;
				
				if (remaining < 0.01) {
					message += `✅ All settled up!`;
				} else {
					message += `💰 Remaining: <b>$${remaining.toFixed(2)}</b>`;
				}
				
				await ctx.editMessageText(message, { 
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[
							{ text: '📊 View All Balances', callback_data: 'view_balance' }
						]]
					}
				});
				
				// Send notification
				try {
					await ctx.api.sendMessage(
						owedId,
						`💵 <b>Partial Payment Received!</b>\n\n` +
						`@${owerName} paid you <b>$${amount.toFixed(2)}</b>\n` +
						`Group: ${ctx.chat?.title || 'your group'}\n` +
						`Remaining: $${remaining.toFixed(2)}`,
						{ parse_mode: 'HTML' }
					);
				} catch {
					// User might have blocked the bot
				}
			});

			// Handle custom partial payment
			bot.callbackQuery(/^partial_custom_/, async (ctx) => {
				await ctx.answerCallbackQuery('Please type the amount you want to pay');
				const parts = ctx.callbackQuery.data.split('_');
				
				let instruction = '';
				if (parts.length === 4) {
					// From partial command
					const toUserId = parts[2];
					const totalOwed = parts[3];
					
					const user = await env.DB.prepare(
						'SELECT username, first_name FROM users WHERE telegram_id = ?'
					).bind(toUserId).first();
					
					const username = user?.username || user?.first_name || 'User';
					instruction = `💵 You owe @${username} $${totalOwed}\n\n`;
				}
				
				instruction += 'Please type the amount you want to pay:\n';
				instruction += 'Example: 15.50';
				
				await ctx.editMessageText(instruction, { parse_mode: 'HTML' });
			});

			// Handle recurring expense callbacks
			bot.callbackQuery(/^recurring_/, async (ctx) => {
				await handleRecurringCallbacks(ctx, env.DB);
			});

			// Handle edit expense callback
			bot.callbackQuery(/^edit:/, async (ctx) => {
				const expenseId = ctx.callbackQuery.data.split(':')[1];
				await handleEditCallback(ctx, env.DB, expenseId);
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
			const reminderStats = await processRecurringReminders(env.DB, bot);
			console.log(`Recurring reminders processed: ${reminderStats.sent} sent, ${reminderStats.errors} errors`);
			
			// Process recurring expenses
			const { processRecurringExpenses } = await import('./utils/process-recurring');
			const recurringStats = await processRecurringExpenses(env.DB, bot);
			console.log(`Recurring expenses processed: ${recurringStats.created} created, ${recurringStats.errors} errors`);
		} catch (error) {
			console.error('Error in scheduled handler:', error);
		}
	},
};

export default worker;

// Export Durable Object for session storage so Workers runtime can instantiate it
export { SessionDO } from './SessionDO';
