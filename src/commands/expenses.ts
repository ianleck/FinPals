import { Context } from 'grammy';
import { eq, and, desc, sql } from 'drizzle-orm';
import { type Database, withRetry, parseDecimal } from '../db';
import { expenses, users, expenseSplits } from '../db/schema';
import { EXPENSE_CATEGORIES } from '../utils/constants';

export async function handleExpenses(ctx: Context, db: Database) {
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();
	
	if (!ctx.from) {
		await ctx.reply('❌ Unable to identify user. Please try again.');
		return;
	}
	
	if (isPersonal) {
		// Show personal expenses
		await handlePersonalExpenses(ctx, db, userId!);
		return;
	}

	if (!ctx.chat?.id) {
		await ctx.reply('❌ Unable to identify chat. Please try again.');
		return;
	}

	const groupId = ctx.chat.id.toString();
	
	try {
		// Get all expenses with payer info and split count
		const expenseList = await withRetry(async () => {
			// Get expenses with payer info
			const expensesWithPayers = await db
				.select({
					id: expenses.id,
					amount: expenses.amount,
					currency: expenses.currency,
					description: expenses.description,
					category: expenses.category,
					createdAt: expenses.createdAt,
					createdBy: expenses.createdBy,
					notes: expenses.notes,
					payerUsername: users.username,
					payerFirstName: users.firstName
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(
					and(
						eq(expenses.groupId, groupId),
						eq(expenses.deleted, false)
					)
				)
				.orderBy(desc(expenses.createdAt));

			// Get split counts for each expense
			const splitCounts = await db
				.select({
					expenseId: expenseSplits.expenseId,
					splitCount: sql<number>`COUNT(*)::int`
				})
				.from(expenseSplits)
				.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
				.where(
					and(
						eq(expenses.groupId, groupId),
						eq(expenses.deleted, false)
					)
				)
				.groupBy(expenseSplits.expenseId);

			// Create a map of split counts
			const splitCountMap = new Map(
				splitCounts.map(sc => [sc.expenseId, sc.splitCount])
			);

			// Combine the data
			return expensesWithPayers.map(exp => ({
				...exp,
				splitCount: splitCountMap.get(exp.id) || 0
			}));
		});

		if (!expenseList || expenseList.length === 0) {
			await ctx.reply(
				'📭 <b>No Expenses Yet</b>\n\n' +
				'Start tracking expenses with /add',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Show the first page
		await showExpensesPage(ctx, expenseList, 0);
	} catch (error) {
		console.error('Error getting expenses:', error);
		await ctx.reply('❌ Error retrieving expenses. Please try again.');
	}
}

export async function showExpensesPage(ctx: Context, expenses: any[], page: number) {
	const pageSize = 5;
	const totalPages = Math.ceil(expenses.length / pageSize);
	const startIdx = page * pageSize;
	const endIdx = Math.min(startIdx + pageSize, expenses.length);
	const pageExpenses = expenses.slice(startIdx, endIdx);

	// Calculate total for this page
	const pageTotal = pageExpenses.reduce((sum, e) => sum + parseDecimal(e.amount), 0);
	const overallTotal = expenses.reduce((sum, e) => sum + parseDecimal(e.amount), 0);

	// Build the message
	let message = `📋 <b>Expenses (Page ${page + 1}/${totalPages})</b>\n`;
	message += `Total: $${overallTotal.toFixed(2)} • This page: $${pageTotal.toFixed(2)}\n\n`;

	pageExpenses.forEach((expense, idx) => {
		const num = startIdx + idx + 1;
		const date = new Date(expense.createdAt).toLocaleDateString();
		const payerName = expense.payerUsername || expense.payerFirstName || 'Unknown';
		const category = expense.category ? `[${expense.category}]` : '[Uncategorized]';
		const amount = parseDecimal(expense.amount);
		
		message += `${num}. <b>${expense.description}</b> ${category}\n`;
		message += `   $${amount.toFixed(2)} by @${payerName} • ${date}\n`;
		message += `   Split: ${expense.splitCount} people\n\n`;
	});

	// Build navigation buttons
	const navButtons = [];
	if (page > 0) {
		navButtons.push({ text: '⬅️ Previous', callback_data: `exp_page:${page - 1}` });
	}
	navButtons.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: 'exp_refresh' });
	if (page < totalPages - 1) {
		navButtons.push({ text: 'Next ➡️', callback_data: `exp_page:${page + 1}` });
	}

	// Build action buttons - show numbers for selection
	const actionButtons = [];
	for (let i = 0; i < pageExpenses.length; i++) {
		actionButtons.push({ 
			text: `${startIdx + i + 1}`, 
			callback_data: `exp_select:${page}:${i}` 
		});
	}

	const keyboard = [
		actionButtons,
		navButtons,
		[{ text: '❌ Close', callback_data: 'close' }]
	];

	const replyOptions = {
		parse_mode: 'HTML' as const,
		reply_markup: {
			inline_keyboard: keyboard
		}
	};

	// If this is from a callback, edit the message
	if (ctx.callbackQuery) {
		await ctx.editMessageText(message, replyOptions);
	} else {
		await ctx.reply(message, replyOptions);
	}
}

// Handle expense selection for actions
export async function handleExpenseSelection(ctx: Context, db: Database) {
	const callbackData = ctx.callbackQuery?.data || '';
	const [_, pageStr, idxStr] = callbackData.split(':');
	const page = parseInt(pageStr);
	const idx = parseInt(idxStr);
	const groupId = ctx.chat?.id.toString();

	if (!groupId) {
		await ctx.answerCallbackQuery('Unable to identify chat');
		return;
	}

	try {
		// Get all expenses again to maintain state
		const expenseList = await withRetry(async () => {
			// Get expenses with payer info
			const expensesWithPayers = await db
				.select({
					id: expenses.id,
					amount: expenses.amount,
					currency: expenses.currency,
					description: expenses.description,
					category: expenses.category,
					createdAt: expenses.createdAt,
					createdBy: expenses.createdBy,
					notes: expenses.notes,
					payerUsername: users.username,
					payerFirstName: users.firstName
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(
					and(
						eq(expenses.groupId, groupId),
						eq(expenses.deleted, false)
					)
				)
				.orderBy(desc(expenses.createdAt));

			// Get split counts for each expense
			const splitCounts = await db
				.select({
					expenseId: expenseSplits.expenseId,
					splitCount: sql<number>`COUNT(*)::int`
				})
				.from(expenseSplits)
				.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
				.where(
					and(
						eq(expenses.groupId, groupId),
						eq(expenses.deleted, false)
					)
				)
				.groupBy(expenseSplits.expenseId);

			// Create a map of split counts
			const splitCountMap = new Map(
				splitCounts.map(sc => [sc.expenseId, sc.splitCount])
			);

			// Combine the data
			return expensesWithPayers.map(exp => ({
				...exp,
				splitCount: splitCountMap.get(exp.id) || 0
			}));
		});

		const expense = expenseList[page * 5 + idx];
		if (!expense) {
			await ctx.answerCallbackQuery('Expense not found');
			return;
		}

		if (!ctx.from) {
			await ctx.answerCallbackQuery('Unable to identify user');
			return;
		}
		const userId = ctx.from.id.toString();
		const canDelete = expense.createdBy === userId;

		// Show expense details with action buttons
		const date = new Date(expense.createdAt).toLocaleDateString();
		const payerName = expense.payerUsername || expense.payerFirstName || 'Unknown';
		const category = expense.category || 'Uncategorized';
		const amount = parseDecimal(expense.amount);

		let detailMessage = `💵 <b>Expense Details</b>\n\n`;
		detailMessage += `<b>Description:</b> ${expense.description}\n`;
		if (expense.notes) {
			detailMessage += `<b>Note:</b> ${expense.notes}\n`;
		}
		detailMessage += `<b>Amount:</b> $${amount.toFixed(2)}\n`;
		detailMessage += `<b>Paid by:</b> @${payerName}\n`;
		detailMessage += `<b>Split:</b> ${expense.splitCount} people\n`;
		detailMessage += `<b>Category:</b> ${category}\n`;
		detailMessage += `<b>Date:</b> ${date}\n`;
		
		// Check for attached receipt
		const { getExpenseReceipt } = await import('./receipt');
		const receipt = await getExpenseReceipt(db, expense.id);
		if (receipt) {
			detailMessage += `<b>Receipt:</b> 📎 Attached\n`;
		}
		
		detailMessage += `\nWhat would you like to do?`;

		const actionButtons = [
			[{ text: '📂 Change Category', callback_data: `cat:${expense.id}:${page}` }],
			[{ text: '✏️ Edit Expense', callback_data: `edit:${expense.id}` }],
			[{ text: '📊 View Full Details', callback_data: `exp:${expense.id}` }]
		];

		// Add View Receipt button if receipt exists
		if (receipt) {
			actionButtons.push([{ text: '📷 View Receipt', callback_data: `view_receipt:${expense.id}` }]);
		}

		if (canDelete) {
			actionButtons.push([{ text: '🗑️ Delete Expense', callback_data: `del:${expense.id}:${page}` }]);
		}

		actionButtons.push([{ text: '⬅️ Back to List', callback_data: `exp_page:${page}` }]);

		await ctx.editMessageText(detailMessage, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: actionButtons
			}
		});

		await ctx.answerCallbackQuery();
	} catch (error) {
		console.error('Error selecting expense:', error);
		await ctx.answerCallbackQuery('Error loading expense');
	}
}

// Handle personal expenses
async function handlePersonalExpenses(ctx: Context, db: Database, userId: string) {
	try {
		// Get all personal expenses
		const expenseList = await withRetry(async () => {
			return await db
				.select({
					id: expenses.id,
					amount: expenses.amount,
					currency: expenses.currency,
					description: expenses.description,
					category: expenses.category,
					createdAt: expenses.createdAt
				})
				.from(expenses)
				.where(
					and(
						eq(expenses.paidBy, userId),
						eq(expenses.isPersonal, true),
						eq(expenses.deleted, false)
					)
				)
				.orderBy(desc(expenses.createdAt));
		});

		if (!expenseList || expenseList.length === 0) {
			await ctx.reply(
				'📭 <b>No Personal Expenses Yet</b>\n\n' +
				'Start tracking with:\n' +
				'<code>/add [amount] [description]</code>',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Show the first page
		await showPersonalExpensesPage(ctx, expenseList, 0);
	} catch (error) {
		console.error('Error getting personal expenses:', error);
		await ctx.reply('❌ Error retrieving expenses. Please try again.');
	}
}

export async function showPersonalExpensesPage(ctx: Context, expenses: any[], page: number) {
	const pageSize = 5;
	const totalPages = Math.ceil(expenses.length / pageSize);
	const startIdx = page * pageSize;
	const endIdx = Math.min(startIdx + pageSize, expenses.length);
	const pageExpenses = expenses.slice(startIdx, endIdx);

	// Calculate totals
	const pageTotal = pageExpenses.reduce((sum, e) => sum + parseDecimal(e.amount), 0);
	const overallTotal = expenses.reduce((sum, e) => sum + parseDecimal(e.amount), 0);

	// Build the message
	let message = `📋 <b>Personal Expenses (Page ${page + 1}/${totalPages})</b>\n`;
	message += `Total: $${overallTotal.toFixed(2)} • This page: $${pageTotal.toFixed(2)}\n\n`;

	pageExpenses.forEach((expense, idx) => {
		const num = startIdx + idx + 1;
		const date = new Date(expense.createdAt).toLocaleDateString();
		const category = expense.category ? `[${expense.category}]` : '[Uncategorized]';
		const amount = parseDecimal(expense.amount);
		
		message += `${num}. <b>${expense.description}</b> ${category}\n`;
		message += `   $${amount.toFixed(2)} • ${date}\n\n`;
	});

	// Build navigation buttons
	const navButtons = [];
	if (page > 0) {
		navButtons.push({ text: '⬅️ Previous', callback_data: `personal_exp_page:${page - 1}` });
	}
	navButtons.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: 'personal_exp_refresh' });
	if (page < totalPages - 1) {
		navButtons.push({ text: 'Next ➡️', callback_data: `personal_exp_page:${page + 1}` });
	}

	// Build action buttons
	const actionButtons = [];
	for (let i = 0; i < pageExpenses.length; i++) {
		actionButtons.push({ 
			text: `${startIdx + i + 1}`, 
			callback_data: `personal_exp_select:${page}:${i}` 
		});
	}

	const keyboard = [
		actionButtons,
		navButtons,
		[
			{ text: '💵 Add Expense', callback_data: 'add_expense_help' },
			{ text: '❌ Close', callback_data: 'close' }
		]
	];

	// Edit or send message
	if (ctx.callbackQuery) {
		await ctx.editMessageText(message, {
			parse_mode: 'HTML',
			reply_markup: { inline_keyboard: keyboard }
		});
	} else {
		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: { inline_keyboard: keyboard }
		});
	}
}