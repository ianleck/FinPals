/**
 * Expense-related callback handlers
 * Handles all expense creation, viewing, editing, and deletion callbacks
 */

import { Bot, Context } from 'grammy';
import { eq, and, desc, sql } from 'drizzle-orm';
import { createDb, withRetry } from '../db';
import { expenses, users, expenseSplits, categoryMappings } from '../db/schema';
import { EXPENSE_CATEGORIES } from '../utils/constants';
import { logger } from '../utils/logger';
import { showExpensesPage, handleExpenseSelection } from '../commands/expenses';
import { handleAdd } from '../commands/add';
import { handleEditCallback } from '../commands/edit';
import { Money } from '../utils/money';
import type { Env } from '../index';

type MyContext = Context & { env: Env };

/**
 * Registers all expense-related callback handlers
 */
export function registerExpenseCallbacks(bot: Bot<MyContext>) {
	// Add expense help
	bot.callbackQuery('add_expense_help', handleAddExpenseHelp);

	// View expenses
	bot.callbackQuery('view_expenses', handleViewExpenses);
	bot.callbackQuery('view_personal_expenses', handleViewPersonalExpenses);

	// Expense navigation
	bot.callbackQuery(/^exp_page:/, handleExpensePage);
	bot.callbackQuery(/^exp_select:/, handleExpenseSelect);
	bot.callbackQuery(/^personal_exp_page:/, handlePersonalExpensePage);

	// Quick add
	bot.callbackQuery(/^quick_add:/, handleQuickAdd);
	bot.callbackQuery('add_expense_custom', handleAddExpenseCustom);

	// Delete expense
	bot.callbackQuery(/^del:/, handleDeleteExpense);
	bot.callbackQuery(/^delete_/, handleDeleteCallback);

	// Category management
	bot.callbackQuery(/^cat:/, handleCategoryChange);
	bot.callbackQuery(/^setcat:/, handleSetCategory);

	// Edit expense
	bot.callbackQuery(/^edit:/, handleEditExpense);
	bot.callbackQuery(/^exp:/, handleExpenseDetails);
}

async function handleAddExpenseHelp(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const isPrivate = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();
	const groupId = ctx.chat?.id.toString();
	const db = createDb(ctx.env);

	// Get recent expenses to suggest
	let recentExpenses: any[] = [];
	if (userId) {
		try {
			if (isPrivate) {
				recentExpenses = await db
					.selectDistinct({
						description: expenses.description,
						amount: expenses.amount,
						category: expenses.category,
					})
					.from(expenses)
					.where(and(eq(expenses.createdBy, userId), eq(expenses.isPersonal, true)))
					.orderBy(desc(expenses.createdAt))
					.limit(3);
			} else if (groupId) {
				recentExpenses = await db
					.selectDistinct({
						description: expenses.description,
						amount: expenses.amount,
						category: expenses.category,
					})
					.from(expenses)
					.where(and(eq(expenses.groupId, groupId), eq(expenses.createdBy, userId), eq(expenses.deleted, false)))
					.orderBy(desc(expenses.createdAt))
					.limit(3);
			}
		} catch {
			logger.error('Error fetching recent expenses');
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
	const recentButtons = recentExpenses.slice(0, 2).map((exp) => [
		{
			text: `↻ $${exp.amount} ${exp.description}`,
			callback_data: `quick_add:${exp.amount}:${exp.description.substring(0, 20)}:${isPrivate ? 'personal' : 'split'}`,
		},
	]);

	const keyboard = [
		...commonAmounts,
		...recentButtons,
		[{ text: '📝 Custom Expense', callback_data: 'add_expense_custom' }],
		[{ text: '❌ Cancel', callback_data: 'close' }],
	];

	if (recentExpenses.length > 0) {
		message += '<b>Recent:</b>\n';
		recentExpenses.forEach((exp) => {
			message += `• $${exp.amount} - ${exp.description}\n`;
		});
		message += '\n';
	}

	message += isPrivate ? 'Choose a quick expense or create custom:' : 'Choose a quick expense to split with everyone:';

	await ctx.reply(message, {
		parse_mode: 'HTML',
		reply_markup: { inline_keyboard: keyboard },
	});
}

async function handleViewExpenses(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const db = createDb(ctx.env);
	await import('../commands/expenses').then((m) => m.handleExpenses(ctx, db));
}

async function handleViewPersonalExpenses(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const db = createDb(ctx.env);
	await import('../commands/expenses').then((m) => m.handleExpenses(ctx, db));
}

async function handleExpensePage(ctx: MyContext) {
	if (!ctx.callbackQuery?.data) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const page = parseInt(ctx.callbackQuery.data.split(':')[1]);
	const groupId = ctx.chat?.id.toString();
	const db = createDb(ctx.env);

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
				split_count: sql<number>`(SELECT COUNT(*) FROM expense_splits WHERE expense_id = ${expenses.id})`,
			})
			.from(expenses)
			.innerJoin(users, eq(expenses.paidBy, users.telegramId))
			.where(and(eq(expenses.groupId, groupId), eq(expenses.deleted, false)))
			.orderBy(desc(expenses.createdAt));

		await ctx.answerCallbackQuery();
		await showExpensesPage(ctx, expensesResult, page);
	} catch {
		logger.error('Error navigating expenses');
		await ctx.answerCallbackQuery('Error loading expenses');
	}
}

async function handleExpenseSelect(ctx: MyContext) {
	const db = createDb(ctx.env);
	await handleExpenseSelection(ctx, db);
}

async function handlePersonalExpensePage(ctx: MyContext) {
	if (!ctx.callbackQuery?.data) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const page = parseInt(ctx.callbackQuery.data.split(':')[1]);
	const userId = ctx.from?.id.toString();

	if (!userId) {
		await ctx.answerCallbackQuery('User not found');
		return;
	}

	const db = createDb(ctx.env);

	try {
		// Get all personal expenses
		const expensesResult = await db
			.select({
				id: expenses.id,
				amount: expenses.amount,
				currency: expenses.currency,
				description: expenses.description,
				category: expenses.category,
				created_at: expenses.createdAt,
			})
			.from(expenses)
			.where(and(eq(expenses.paidBy, userId), eq(expenses.isPersonal, true), eq(expenses.deleted, false)))
			.orderBy(desc(expenses.createdAt));

		await ctx.answerCallbackQuery();
		const { showPersonalExpensesPage } = await import('../commands/expenses');
		await showPersonalExpensesPage(ctx, expensesResult, page);
	} catch {
		logger.error('Error navigating personal expenses');
		await ctx.answerCallbackQuery('Error loading expenses');
	}
}

async function handleQuickAdd(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	if (!ctx.callbackQuery?.data) {
		return;
	}
	const data = ctx.callbackQuery.data.split(':');
	const amount = data[1];
	const description = data[2];
	const type = data[3]; // 'personal' or 'split'
	const db = createDb(ctx.env);

	// Execute the add command
	const command = type === 'personal' || ctx.chat?.type === 'private' ? `/add ${amount} ${description}` : `/add ${amount} ${description}`;

	// Create a fake message context for handleAdd
	const fakeCtx = {
		...ctx,
		message: {
			message_id: ctx.callbackQuery.message?.message_id || 0,
			date: ctx.callbackQuery.message?.date || Date.now(),
			chat: ctx.chat!,
			text: command,
			entities: [],
			from: ctx.from,
		},
	};

	// Delete the quick add menu
	await ctx.deleteMessage();

	// Process the expense
	await handleAdd(fakeCtx as any, db);
}

async function handleAddExpenseCustom(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	await ctx.deleteMessage();

	const isPrivate = ctx.chat?.type === 'private';
	await ctx.reply(
		isPrivate
			? '💵 To add a custom expense, use:\n<code>/add [amount] [description]</code>\n\nExample: <code>/add 25.50 lunch</code>'
			: '💵 To add a custom expense, use:\n<code>/add [amount] [description] [@mentions]</code>\n\nExamples:\n• <code>/add 50 dinner</code> - Split with everyone\n• <code>/add 30 coffee @john</code> - Split with John',
		{ parse_mode: 'HTML' },
	);
}

async function handleDeleteExpense(ctx: MyContext) {
	if (!ctx.callbackQuery?.data || !ctx.from) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const parts = ctx.callbackQuery.data.split(':');
	const expenseId = parts[1];
	const returnPage = parts[2] ? parseInt(parts[2]) : null;
	const groupId = ctx.chat?.id.toString();
	const userId = ctx.from.id.toString();
	const db = createDb(ctx.env);

	try {
		// Check if expense exists and user has permission
		const expenseResult = await db
			.select({
				id: expenses.id,
				description: expenses.description,
				amount: expenses.amount,
				created_by: expenses.createdBy,
			})
			.from(expenses)
			.where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId!), eq(expenses.deleted, false)))
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
		await db.update(expenses).set({ deleted: true }).where(eq(expenses.id, expenseId));

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
					split_count: sql<number>`(SELECT COUNT(*) FROM expense_splits WHERE expense_id = ${expenses.id})`,
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(and(eq(expenses.groupId, groupId!), eq(expenses.deleted, false)))
				.orderBy(desc(expenses.createdAt));

			await showExpensesPage(ctx, expensesResult, returnPage);
		} else {
			// Just update the message
			await ctx.editMessageText(`❌ <b>Deleted:</b> ${expense.description} - $${parseFloat(expense.amount).toFixed(2)}`, {
				parse_mode: 'HTML',
			});
		}
	} catch {
		logger.error('Error deleting expense');
		await ctx.answerCallbackQuery('Error deleting expense');
	}
}

async function handleDeleteCallback(ctx: MyContext) {
	await ctx.answerCallbackQuery();

	if (!ctx.callbackQuery?.data || !ctx.from) {
		return;
	}
	const expenseId = ctx.callbackQuery.data.split('_')[1];
	const groupId = ctx.chat!.id.toString();
	const userId = ctx.from.id.toString();
	const db = createDb(ctx.env);

	try {
		// Check if expense exists and user has permission to delete
		const expenseResult = await db
			.select({
				id: expenses.id,
				description: expenses.description,
				amount: expenses.amount,
				created_by: expenses.createdBy,
				username: users.username,
				first_name: users.firstName,
			})
			.from(expenses)
			.innerJoin(users, eq(expenses.createdBy, users.telegramId))
			.where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId!), eq(expenses.deleted, false)))
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
			await ctx.editMessageText(`❌ Only @${creatorName} or admins can delete this expense`);
			return;
		}

		// Soft delete the expense
		await db.update(expenses).set({ deleted: true }).where(eq(expenses.id, expenseId));

		await ctx.editMessageText(
			`✅ <b>Expense Deleted</b>\n\n` +
				`"${expense.description}" - $${parseFloat(expense.amount).toFixed(2)}\n\n` +
				`The balances have been updated.`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{ text: '📊 View Balance', callback_data: 'view_balance' }],
						[{ text: '📜 View History', callback_data: 'view_history' }],
					],
				},
			},
		);
	} catch {
		logger.error('Error deleting expense');
		await ctx.answerCallbackQuery('Error deleting expense');
	}
}

async function handleCategoryChange(ctx: MyContext) {
	if (!ctx.callbackQuery?.data) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const parts = ctx.callbackQuery.data.split(':');
	const expenseId = parts[1];
	const returnPage = parts[2] ? parseInt(parts[2]) : null;
	await ctx.answerCallbackQuery();

	const categories = EXPENSE_CATEGORIES.map((cat, i) => {
		const callbackData = returnPage !== null ? `setcat:${expenseId}:${i}:${returnPage}` : `setcat:${expenseId}:${i}`;
		return [{ text: cat, callback_data: callbackData }];
	});

	// Add cancel button
	categories.push([
		{
			text: '❌ Cancel',
			callback_data: returnPage !== null ? `exp_page:${returnPage}` : 'close',
		},
	]);

	await ctx.editMessageText('📂 <b>Select a category:</b>', {
		parse_mode: 'HTML',
		reply_markup: {
			inline_keyboard: categories,
		},
	});
}

async function handleSetCategory(ctx: MyContext) {
	if (!ctx.callbackQuery?.data) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const parts = ctx.callbackQuery.data.split(':');
	const expenseId = parts[1];
	const categoryIndex = parseInt(parts[2]);
	const returnPage = parts[3] ? parseInt(parts[3]) : null;
	const category = EXPENSE_CATEGORIES[categoryIndex];
	const groupId = ctx.chat?.id.toString();
	const db = createDb(ctx.env);

	if (!groupId) {
		await ctx.answerCallbackQuery('Unable to identify chat');
		return;
	}

	try {
		// Get expense details
		const expenseResult = await db
			.select({
				description: expenses.description,
				amount: expenses.amount,
			})
			.from(expenses)
			.where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId!), eq(expenses.deleted, false)))
			.limit(1);

		const expense = expenseResult[0];

		if (!expense) {
			await ctx.answerCallbackQuery('Expense not found');
			return;
		}

		// Update category
		await db.update(expenses).set({ category: category }).where(eq(expenses.id, expenseId));

		// Update category mapping for learning
		const descPattern = expense.description?.toString().toLowerCase() || '';
		await db
			.insert(categoryMappings)
			.values({
				descriptionPattern: descPattern,
				category: category,
				confidence: '1.00',
			})
			.onConflictDoUpdate({
				target: categoryMappings.descriptionPattern,
				set: {
					category: category,
					usageCount: sql`${categoryMappings.usageCount} + 1`,
					confidence: sql`MIN(1.0, ${categoryMappings.confidence} + 0.1)::decimal(3,2)`,
				},
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
					split_count: sql<number>`(SELECT COUNT(*) FROM expense_splits WHERE expense_id = ${expenses.id})`,
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(and(eq(expenses.groupId, groupId!), eq(expenses.deleted, false)))
				.orderBy(desc(expenses.createdAt));

			await showExpensesPage(ctx, expensesResult, returnPage);
		} else {
			// Just delete the message
			await ctx.deleteMessage();
		}
	} catch {
		logger.error('Error updating category');
		await ctx.answerCallbackQuery('Error updating category');
	}
}

async function handleEditExpense(ctx: MyContext) {
	if (!ctx.callbackQuery?.data) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const expenseId = ctx.callbackQuery.data.split(':')[1];
	const db = createDb(ctx.env);
	await handleEditCallback(ctx, db, expenseId);
}

async function handleExpenseDetails(ctx: MyContext) {
	if (!ctx.callbackQuery?.data) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const expenseId = ctx.callbackQuery.data.split(':')[1];
	const groupId = ctx.chat?.id.toString();
	const db = createDb(ctx.env);

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
				payer_first_name: users.firstName,
			})
			.from(expenses)
			.innerJoin(users, eq(expenses.paidBy, users.telegramId))
			.where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId!), eq(expenses.deleted, false)))
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
				first_name: users.firstName,
			})
			.from(expenseSplits)
			.innerJoin(users, eq(expenseSplits.userId, users.telegramId))
			.where(eq(expenseSplits.expenseId, expenseId));

		const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
		const splitDetails = splitsResult
			.map((s) => `  • @${s.username || s.first_name || 'Unknown'}: $${parseFloat(s.amount).toFixed(2)}`)
			.join('\n');

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
	} catch {
		logger.error('Error getting expense details');
		await ctx.answerCallbackQuery('Error loading details');
	}
}
