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
import { handleExpenses, showExpensesPage, handleExpenseSelection } from './commands/expenses';
import { handleDelete } from './commands/delete';
import { handleEdit, handleEditCallback } from './commands/edit';
import { handleTest } from './commands/test';
import { handleInfo } from './commands/info';
import { trackGroupMetadata } from './utils/group-tracker';
import type { SessionData } from './utils/session';
import { COMMANDS, EXPENSE_CATEGORIES } from './utils/constants';
import { eq, and, desc, sql, or, inArray, gte, lte, isNull } from 'drizzle-orm';
import { expenses, users, expenseSplits, settlements, groups, groupMembers, trips, categoryMappings } from './db/schema';
import { getFirstResult } from './utils/db-helpers';

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
			
			// Handle view expense from search results
			bot.hears(/^\/view_/, async (ctx) => {
				const expenseId = ctx.message?.text?.split('_')[1];
				if (expenseId) {
					// Direct query to get expense details
					const expenseResult = await db
						.select({
							id: expenses.id,
							amount: expenses.amount,
							currency: expenses.currency,
							description: expenses.description,
							category: expenses.category,
							created_at: expenses.createdAt,
							created_by: expenses.createdBy,
							notes: expenses.notes,
							payer_username: users.username,
							payer_first_name: users.firstName,
							split_count: sql<number>`(SELECT COUNT(*) FROM expense_splits WHERE expense_id = ${expenses.id})`
						})
						.from(expenses)
						.innerJoin(users, eq(expenses.paidBy, users.telegramId))
						.where(eq(expenses.id, expenseId))
						.limit(1);
					
					const expense = expenseResult[0];
					
					if (expense) {
						// Create a fake callback context
						ctx.callbackQuery = {
							data: `exp:0:${expenseId}`,
							message: ctx.message
						} as any;
						await handleExpenseSelection(ctx, db);
					} else {
						await ctx.reply('❌ Expense not found');
					}
				}
			});
			
			// Photo messages not handled (receipt functionality deprecated)
			


			// Handle callback queries
			bot.callbackQuery('add_expense_help', async (ctx) => {
				await ctx.answerCallbackQuery();
				const isPrivate = ctx.chat?.type === 'private';
				const userId = ctx.from?.id.toString();
				const groupId = ctx.chat?.id.toString();
				
				// Get recent expenses to suggest
				let recentExpenses: any[] = [];
				if (userId) {
					try {
						if (isPrivate) {
							recentExpenses = await db
								.selectDistinct({
									description: expenses.description,
									amount: expenses.amount,
									category: expenses.category
								})
								.from(expenses)
								.where(and(
									eq(expenses.createdBy, userId),
									eq(expenses.isPersonal, true)
								))
								.orderBy(desc(expenses.createdAt))
								.limit(3);
						} else if (groupId) {
							recentExpenses = await db
								.selectDistinct({
									description: expenses.description,
									amount: expenses.amount,
									category: expenses.category
								})
								.from(expenses)
								.where(and(
									eq(expenses.groupId, groupId),
									eq(expenses.createdBy, userId),
									eq(expenses.deleted, false)
								))
								.orderBy(desc(expenses.createdAt))
								.limit(3);
						}
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
					const { getSimplifiedSettlementPlan } = await import('./utils/debt-simplification');
					const { transactions, message } = await getSimplifiedSettlementPlan(db, groupId, tripId);
					
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
				await handleHistory(ctx, db);
			});


			bot.callbackQuery('view_expenses', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, db);
			});

			bot.callbackQuery('view_personal_expenses', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleExpenses(ctx, db);
			});

			bot.callbackQuery('view_stats', async (ctx) => {
				await ctx.answerCallbackQuery();
				await handleStats(ctx, db);
			});

			bot.callbackQuery('view_trends', async (ctx) => {
				await ctx.answerCallbackQuery();
				const groupId = ctx.chat?.id.toString();
				if (!groupId) return;
				
				try {
					const { generateSpendingTrends, formatTrendsMessage } = await import('./utils/spending-visualization');
					const { trends, categoryTrends, insights } = await generateSpendingTrends(db, groupId);
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
				await showUnsettledBalances(ctx, db);
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
				
				if (!groupId) {
					await ctx.answerCallbackQuery('Unable to identify chat');
					return;
				}

				try {
					// Get all expenses
					const expensesResult = await db
						.select({
							id: expenses.id,
							amount: expenses.amount,
							currency: expenses.currency,
							description: expenses.description,
							category: expenses.category,
							created_at: expenses.createdAt,
							created_by: expenses.createdBy,
							payer_username: users.username,
							payer_first_name: users.firstName,
							split_count: sql<number>`(SELECT COUNT(*) FROM expense_splits WHERE expense_id = ${expenses.id})`
						})
						.from(expenses)
						.innerJoin(users, eq(expenses.paidBy, users.telegramId))
						.where(and(
							eq(expenses.groupId, groupId),
							eq(expenses.deleted, false)
						))
						.orderBy(desc(expenses.createdAt));

					await ctx.answerCallbackQuery();
					await showExpensesPage(ctx, expensesResult, page);
				} catch (error) {
					console.error('Error navigating expenses:', error);
					await ctx.answerCallbackQuery('Error loading expenses');
				}
			});

			// Handle expense selection
			bot.callbackQuery(/^exp_select:/, async (ctx) => {
				await handleExpenseSelection(ctx, db);
			});

			// Handle personal expense page navigation
			bot.callbackQuery(/^personal_exp_page:/, async (ctx) => {
				const page = parseInt(ctx.callbackQuery.data.split(':')[1]);
				const userId = ctx.from?.id.toString();

				try {
					// Get all personal expenses
					const expensesResult = await db
						.select({
							id: expenses.id,
							amount: expenses.amount,
							currency: expenses.currency,
							description: expenses.description,
							category: expenses.category,
							created_at: expenses.createdAt
						})
						.from(expenses)
						.where(and(
							eq(expenses.paidBy, userId),
							eq(expenses.isPersonal, true),
							eq(expenses.deleted, false)
						))
						.orderBy(desc(expenses.createdAt));

					await ctx.answerCallbackQuery();
					const { showPersonalExpensesPage } = await import('./commands/expenses');
					await showPersonalExpensesPage(ctx, expensesResult, page);
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
				await handleAdd(fakeCtx as any, db);
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

			// Handle search help callback
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



			// Handle delete expense callback
			bot.callbackQuery(/^del:/, async (ctx) => {
				const parts = ctx.callbackQuery.data.split(':');
				const expenseId = parts[1];
				const returnPage = parts[2] ? parseInt(parts[2]) : null;
				const groupId = ctx.chat?.id.toString();
				const userId = ctx.from.id.toString();

				try {
					// Check if expense exists and user has permission
					const expenseResult = await db
						.select({
							id: expenses.id,
							description: expenses.description,
							amount: expenses.amount,
							created_by: expenses.createdBy
						})
						.from(expenses)
						.where(and(
							eq(expenses.id, expenseId),
							eq(expenses.groupId, groupId!),
							eq(expenses.deleted, false)
						))
						.limit(1);
					
					const expense = expenseResult[0];

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
					await db
						.update(expenses)
						.set({ deleted: true })
						.where(eq(expenses.id, expenseId));

					await ctx.answerCallbackQuery('Expense deleted successfully');
					
					// If we have a return page, go back to the expenses list
					if (returnPage !== null) {
						// Get updated expenses
						const expensesResult = await db
							.select({
								id: expenses.id,
								amount: expenses.amount,
								currency: expenses.currency,
								description: expenses.description,
								category: expenses.category,
								created_at: expenses.createdAt,
								created_by: expenses.createdBy,
								payer_username: users.username,
								payer_first_name: users.firstName,
								split_count: sql<number>`(SELECT COUNT(*) FROM expense_splits WHERE expense_id = ${expenses.id})`
							})
							.from(expenses)
							.innerJoin(users, eq(expenses.paidBy, users.telegramId))
							.where(and(
								eq(expenses.groupId, groupId!),
								eq(expenses.deleted, false)
							))
							.orderBy(desc(expenses.createdAt));

						await showExpensesPage(ctx, expensesResult, returnPage);
					} else {
						// Just update the message
						await ctx.editMessageText(
							`❌ <b>Deleted:</b> ${expense.description} - $${parseFloat(expense.amount).toFixed(2)}`,
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
					const expenseResult = await db
						.select({
							id: expenses.id,
							description: expenses.description,
							amount: expenses.amount,
							created_by: expenses.createdBy,
							username: users.username,
							first_name: users.firstName
						})
						.from(expenses)
						.innerJoin(users, eq(expenses.createdBy, users.telegramId))
						.where(and(
							eq(expenses.id, expenseId),
							eq(expenses.groupId, groupId!),
							eq(expenses.deleted, false)
						))
						.limit(1);
					
					const expense = expenseResult[0];

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
					await db
						.update(expenses)
						.set({ deleted: true })
						.where(eq(expenses.id, expenseId));

					await ctx.editMessageText(
						`✅ <b>Expense Deleted</b>\n\n` +
						`"${expense.description}" - $${parseFloat(expense.amount).toFixed(2)}\n\n` +
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

			// Receipt functionality temporarily disabled
			// bot.callbackQuery(/^receipt:/, async (ctx) => {
			// 	await handleReceiptCallback(ctx, db);
			// });

			// // Handle cancel receipt callback
			// bot.callbackQuery('cancel_receipt', async (ctx) => {
			// 	await handleCancelReceipt(ctx);
			// });

			// Receipt viewing temporarily disabled
			// bot.callbackQuery(/^view_receipt:/, async (ctx) => {
			// 	const expenseId = ctx.callbackQuery.data.split(':')[1];
			// 	await ctx.answerCallbackQuery();
			// 	
			// 	try {
			// 		const receipt = await getExpenseReceipt(db, expenseId);
			// 		
			// 		if (receipt) {
			// 			// Send the photo
			// 			await ctx.replyWithPhoto(receipt.file_id, {
			// 				caption: '📷 Receipt photo'
			// 			});
			// 		} else {
			// 			await ctx.reply('❌ No receipt found for this expense');
			// 		}
			// 	} catch (error) {
			// 		console.error('Error viewing receipt:', error);
			// 		await ctx.reply('❌ Error loading receipt');
			// 	}
			// });

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
				
				if (!groupId) {
					await ctx.answerCallbackQuery('Unable to identify chat');
					return;
				}

				try {
					// Get expense details
					const expenseResult = await db
						.select({
							description: expenses.description,
							amount: expenses.amount
						})
						.from(expenses)
						.where(and(
							eq(expenses.id, expenseId),
							eq(expenses.groupId, groupId!),
							eq(expenses.deleted, false)
						))
						.limit(1);
					
					const expense = expenseResult[0];

					if (!expense) {
						await ctx.answerCallbackQuery('Expense not found');
						return;
					}

					// Update category
					await db
						.update(expenses)
						.set({ category: category })
						.where(eq(expenses.id, expenseId));

					// Update category mapping for learning
					const descPattern = (expense.description?.toString().toLowerCase() || '');
					await db
						.insert(categoryMappings)
						.values({
							descriptionPattern: descPattern,
							category: category,
							confidence: '1.00'
						})
						.onConflictDoUpdate({
							target: categoryMappings.descriptionPattern,
							set: {
								category: category,
								usageCount: sql`${categoryMappings.usageCount} + 1`,
								confidence: sql`MIN(1.0, ${categoryMappings.confidence} + 0.1)::decimal(3,2)`
							}
						});

					await ctx.answerCallbackQuery(`Category updated to ${category}`);
					
					// If we have a return page, go back to the expenses list
					if (returnPage !== null) {
						// Get updated expenses
						const expensesResult = await db
							.select({
								id: expenses.id,
								amount: expenses.amount,
								currency: expenses.currency,
								description: expenses.description,
								category: expenses.category,
								created_at: expenses.createdAt,
								created_by: expenses.createdBy,
								payer_username: users.username,
								payer_first_name: users.firstName,
								split_count: sql<number>`(SELECT COUNT(*) FROM expense_splits WHERE expense_id = ${expenses.id})`
							})
							.from(expenses)
							.innerJoin(users, eq(expenses.paidBy, users.telegramId))
							.where(and(
								eq(expenses.groupId, groupId!),
								eq(expenses.deleted, false)
							))
							.orderBy(desc(expenses.createdAt));

						await showExpensesPage(ctx, expensesResult, returnPage);
					} else {
						// Just delete the message
						await ctx.deleteMessage();
					}
				} catch (error) {
					console.error('Error updating category:', error);
					await ctx.answerCallbackQuery('Error updating category');
				}
			});



			// Handle settle button callback
			bot.callbackQuery(/^settle_/, async (ctx) => {
				await handleSettleCallback(ctx, db);
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
				await db.insert(settlements).values({
					id: settlementId,
					groupId: groupId,
					fromUser: owerId,
					toUser: owedId,
					amount: amount.toString(),
					createdBy: ctx.from!.id.toString()
				});
				
				// Get usernames
				const usersResult = await db
					.select({
						telegram_id: users.telegramId,
						username: users.username,
						first_name: users.firstName
					})
					.from(users)
					.where(or(
						eq(users.telegramId, owerId),
						eq(users.telegramId, owedId)
					));
				
				const owerUser = usersResult.find(u => u.telegram_id === owerId);
				const owedUser = usersResult.find(u => u.telegram_id === owedId);
				
				const owerName = owerUser?.username || owerUser?.first_name || 'User';
				const owedName = owedUser?.username || owedUser?.first_name || 'User';
				
				// Get remaining balance
				const remainingBalanceResult = await db.execute(sql`
					WITH expense_balances AS (
						SELECT 
							e.paid_by as creditor,
							es.user_id as debtor,
							SUM(es.amount) as amount
						FROM expenses e
						JOIN expense_splits es ON e.id = es.expense_id
						WHERE e.group_id = ${groupId} AND e.deleted = FALSE
							AND ((e.paid_by = ${owerId} AND es.user_id = ${owedId}) OR (e.paid_by = ${owedId} AND es.user_id = ${owerId}))
						GROUP BY e.paid_by, es.user_id
					),
					settlement_balances AS (
						SELECT 
							to_user as creditor,
							from_user as debtor,
							SUM(amount) as amount
						FROM settlements
						WHERE group_id = ${groupId}
							AND ((to_user = ${owerId} AND from_user = ${owedId}) OR (to_user = ${owedId} AND from_user = ${owerId}))
						GROUP BY to_user, from_user
					)
					SELECT 
						SUM(CASE 
							WHEN creditor = ${owedId} AND debtor = ${owerId} THEN amount
							WHEN creditor = ${owerId} AND debtor = ${owedId} THEN -amount
							ELSE 0
						END) as net_balance
					FROM (
						SELECT creditor, debtor, amount FROM expense_balances
						UNION ALL
						SELECT creditor, debtor, -amount FROM settlement_balances
					)
				`);
				
				const remainingBalance = getFirstResult<any>(remainingBalanceResult);
				
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
					
					const userResult = await db
						.select({
							username: users.username,
							first_name: users.firstName
						})
						.from(users)
						.where(eq(users.telegramId, toUserId))
						.limit(1);
					
					const user = userResult[0];
					
					const username = user?.username || user?.first_name || 'User';
					instruction = `💵 You owe @${username} $${totalOwed}\n\n`;
				}
				
				instruction += 'Please type the amount you want to pay:\n';
				instruction += 'Example: 15.50';
				
				await ctx.editMessageText(instruction, { parse_mode: 'HTML' });
			});


			// Handle edit expense callback
			bot.callbackQuery(/^edit:/, async (ctx) => {
				const expenseId = ctx.callbackQuery.data.split(':')[1];
				await handleEditCallback(ctx, db, expenseId);
			});

			// Handle expense details callback
			bot.callbackQuery(/^exp:/, async (ctx) => {
				const expenseId = ctx.callbackQuery.data.split(':')[1];
				const groupId = ctx.chat?.id.toString();
				
				if (!groupId) {
					await ctx.answerCallbackQuery('Unable to identify chat');
					return;
				}

				try {
					// Get expense with full details
					const expenseResult = await db
						.select({
							id: expenses.id,
							amount: expenses.amount,
							currency: expenses.currency,
							description: expenses.description,
							category: expenses.category,
							paidBy: expenses.paidBy,
							createdAt: expenses.createdAt,
							notes: expenses.notes,
							payer_username: users.username,
							payer_first_name: users.firstName
						})
						.from(expenses)
						.innerJoin(users, eq(expenses.paidBy, users.telegramId))
						.where(and(
							eq(expenses.id, expenseId),
							eq(expenses.groupId, groupId!),
							eq(expenses.deleted, false)
						))
						.limit(1);
					
					const expense = expenseResult[0];

					if (!expense) {
						await ctx.answerCallbackQuery('Expense not found');
						return;
					}

					// Get splits
					const splitsResult = await db
						.select({
							amount: expenseSplits.amount,
							username: users.username,
							first_name: users.firstName
						})
						.from(expenseSplits)
						.innerJoin(users, eq(expenseSplits.userId, users.telegramId))
						.where(eq(expenseSplits.expenseId, expenseId));

					const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
					const splitDetails = splitsResult.map((s) => 
						`  • @${s.username || s.first_name || 'Unknown'}: $${parseFloat(s.amount).toFixed(2)}`
					).join('\n');

					const details = 
						`📊 <b>Expense Details</b>\n\n` +
						`<b>Description:</b> ${expense.description}\n` +
						`<b>Total Amount:</b> $${parseFloat(expense.amount).toFixed(2)}\n` +
						`<b>Paid by:</b> @${payerName}\n` +
						`<b>Category:</b> ${expense.category || 'Uncategorized'}\n` +
						`<b>Date:</b> ${new Date(expense.createdAt).toLocaleString()}\n\n` +
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
	
	async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
		try {
			// Scheduled tasks have been deprecated with the migration to CockroachDB
			console.log('Scheduled task triggered - no actions taken (deprecated)');
		} catch (error) {
			console.error('Error in scheduled handler:', error);
		}
	},
};

export default worker;

// Export Durable Object for session storage so Workers runtime can instantiate it
export { SessionDO } from './SessionDO';
