import { Context } from 'grammy';
import { EXPENSE_CATEGORIES } from '../utils/constants';

export async function handleExpenses(ctx: Context, db: D1Database) {
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
		// Get all expenses
		const expenses = await db.prepare(`
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

		if (!expenses.results || expenses.results.length === 0) {
			await ctx.reply(
				'📭 <b>No Expenses Yet</b>\n\n' +
				'Start tracking expenses with /add',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Show the first page
		await showExpensesPage(ctx, expenses.results, 0);
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
	const pageTotal = pageExpenses.reduce((sum, e) => sum + (e.amount as number), 0);
	const overallTotal = expenses.reduce((sum, e) => sum + (e.amount as number), 0);

	// Build the message
	let message = `📋 <b>Expenses (Page ${page + 1}/${totalPages})</b>\n`;
	message += `Total: $${overallTotal.toFixed(2)} • This page: $${pageTotal.toFixed(2)}\n\n`;

	pageExpenses.forEach((expense, idx) => {
		const num = startIdx + idx + 1;
		const date = new Date(expense.created_at as string).toLocaleDateString();
		const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
		const category = expense.category ? `[${expense.category}]` : '[Uncategorized]';
		
		message += `${num}. <b>${expense.description}</b> ${category}\n`;
		message += `   $${(expense.amount as number).toFixed(2)} by @${payerName} • ${date}\n`;
		message += `   Split: ${expense.split_count} people\n\n`;
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
export async function handleExpenseSelection(ctx: Context, db: D1Database) {
	const callbackData = ctx.callbackQuery?.data || '';
	const [_, pageStr, idxStr] = callbackData.split(':');
	const page = parseInt(pageStr);
	const idx = parseInt(idxStr);
	const groupId = ctx.chat?.id.toString();

	try {
		// Get all expenses again to maintain state
		const expenses = await db.prepare(`
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

		const expense = expenses.results[page * 5 + idx];
		if (!expense) {
			await ctx.answerCallbackQuery('Expense not found');
			return;
		}

		if (!ctx.from) {
			await ctx.answerCallbackQuery('Unable to identify user');
			return;
		}
		const userId = ctx.from.id.toString();
		const canDelete = expense.created_by === userId;

		// Show expense details with action buttons
		const date = new Date(expense.created_at as string).toLocaleDateString();
		const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
		const category = expense.category || 'Uncategorized';

		let detailMessage = `💵 <b>Expense Details</b>\n\n`;
		detailMessage += `<b>Description:</b> ${expense.description}\n`;
		detailMessage += `<b>Amount:</b> $${(expense.amount as number).toFixed(2)}\n`;
		detailMessage += `<b>Paid by:</b> @${payerName}\n`;
		detailMessage += `<b>Split:</b> ${expense.split_count} people\n`;
		detailMessage += `<b>Category:</b> ${category}\n`;
		detailMessage += `<b>Date:</b> ${date}\n\n`;
		detailMessage += `What would you like to do?`;

		const actionButtons = [
			[{ text: '📂 Change Category', callback_data: `cat:${expense.id}:${page}` }],
			[{ text: '📊 View Full Details', callback_data: `exp:${expense.id}` }]
		];

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
async function handlePersonalExpenses(ctx: Context, db: D1Database, userId: string) {
	try {
		// Get all personal expenses
		const expenses = await db.prepare(`
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

		if (!expenses.results || expenses.results.length === 0) {
			await ctx.reply(
				'📭 <b>No Personal Expenses Yet</b>\n\n' +
				'Start tracking with:\n' +
				'<code>/add [amount] [description]</code>',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Show the first page
		await showPersonalExpensesPage(ctx, expenses.results, 0);
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
	const pageTotal = pageExpenses.reduce((sum, e) => sum + (e.amount as number), 0);
	const overallTotal = expenses.reduce((sum, e) => sum + (e.amount as number), 0);

	// Build the message
	let message = `📋 <b>Personal Expenses (Page ${page + 1}/${totalPages})</b>\n`;
	message += `Total: $${overallTotal.toFixed(2)} • This page: $${pageTotal.toFixed(2)}\n\n`;

	pageExpenses.forEach((expense, idx) => {
		const num = startIdx + idx + 1;
		const date = new Date(expense.created_at as string).toLocaleDateString();
		const category = expense.category ? `[${expense.category}]` : '[Uncategorized]';
		
		message += `${num}. <b>${expense.description}</b> ${category}\n`;
		message += `   $${(expense.amount as number).toFixed(2)} • ${date}\n\n`;
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