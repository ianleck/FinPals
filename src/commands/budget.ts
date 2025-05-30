import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';
import { reply } from '../utils/reply';


export async function handleBudget(ctx: Context, db: D1Database): Promise<void> {
	// Only work in private chats
	if (ctx.chat?.type !== 'private') {
		await reply(ctx, '💬 This command only works in private chat. DM me directly!');
		return;
	}

	const userId = ctx.from!.id.toString();
	const args = ctx.message?.text?.split(' ').slice(1) || [];

	if (args.length === 0) {
		await showBudgetMenu(ctx, db, userId);
		return;
	}

	const action = args[0].toLowerCase();

	try {
		switch (action) {
			case 'set':
				await setBudget(ctx, db, userId, args.slice(1));
				break;
			case 'view':
				await viewBudgets(ctx, db, userId);
				break;
			case 'delete':
				await deleteBudget(ctx, db, userId, args.slice(1));
				break;
			default:
				await reply(ctx, '❌ Invalid action. Use /budget for help.');
		}
	} catch (error) {
		console.error('Error managing budget:', error);
		await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
	}
}

async function showBudgetMenu(ctx: Context, db: D1Database, userId: string): Promise<void> {
	const budgets = await db.prepare(`
		SELECT b.*, 
			COALESCE(
				-- Group expense splits
				(SELECT SUM(es.amount) 
				 FROM expense_splits es
				 JOIN expenses e ON e.id = es.expense_id
				 WHERE es.user_id = b.user_id 
				   AND LOWER(TRIM(e.category)) = LOWER(TRIM(b.category)) 
				   AND e.deleted = FALSE
				   AND e.is_personal = FALSE
				   AND datetime(e.created_at) >= datetime('now', 
				        CASE 
				            WHEN b.period = 'daily' THEN '-1 day'
				            WHEN b.period = 'weekly' THEN '-7 days'
				            WHEN b.period = 'monthly' THEN '-1 month'
				        END)
				), 0
			) + 
			COALESCE(
				-- Personal expenses
				(SELECT SUM(e.amount)
				 FROM expenses e
				 WHERE e.paid_by = b.user_id
				   AND LOWER(TRIM(e.category)) = LOWER(TRIM(b.category))
				   AND e.deleted = FALSE
				   AND e.is_personal = TRUE
				   AND datetime(e.created_at) >= datetime('now', 
				        CASE 
				            WHEN b.period = 'daily' THEN '-1 day'
				            WHEN b.period = 'weekly' THEN '-7 days'
				            WHEN b.period = 'monthly' THEN '-1 month'
				        END)
				), 0
			) as spent
		FROM budgets b
		WHERE b.user_id = ?
		GROUP BY b.id
	`).bind(userId).all();

	let message = '💰 <b>Budget Management</b>\n\n';

	if (budgets.results && budgets.results.length > 0) {
		message += '<b>Your Current Budgets:</b>\n';
		for (const budget of budgets.results) {
			const spent = budget.spent as number || 0;
			const amount = budget.amount as number;
			const percentage = (spent / amount * 100).toFixed(0);
			const emoji = spent > amount ? '🔴' : spent > amount * 0.8 ? '🟡' : '🟢';
			
			message += `\n${emoji} <b>${budget.category}</b>\n`;
			message += `   Budget: $${amount} ${budget.period}\n`;
			message += `   Spent: $${spent.toFixed(2)} (${percentage}%)\n`;
		}
		message += '\n';
	} else {
		message += 'No budgets set yet.\n\n';
	}

	message += '<b>Commands:</b>\n';
	message += '/budget set [category] [amount] [period] - Set budget\n';
	message += '/budget view - View all budgets\n';
	message += '/budget delete [category] - Remove budget\n\n';
	message += '<i>Example: /budget set "Food & Dining" 500 monthly</i>';

	await reply(ctx, message, {
		parse_mode: 'HTML',
		reply_markup: {
			inline_keyboard: [
				[{ text: '➕ Set New Budget', callback_data: 'budget_set_help' }],
				[{ text: '📊 View Spending Report', callback_data: 'spending_report' }]
			]
		}
	});
}

async function setBudget(ctx: Context, db: D1Database, userId: string, args: string[]): Promise<void> {
	if (args.length < 3) {
		await reply(ctx, 
			'❌ Invalid format!\n\n' +
			'Usage: /budget set [category] [amount] [period]\n' +
			'Period: daily, weekly, or monthly\n\n' +
			'Example: /budget set "Food & Dining" 500 monthly'
		);
		return;
	}

	// Parse category (might have spaces)
	let category = '';
	let amountIndex = -1;
	
	// Find where the number starts
	for (let i = 0; i < args.length - 1; i++) {
		if (!isNaN(parseFloat(args[i]))) {
			amountIndex = i;
			break;
		}
	}

	if (amountIndex === -1) {
		await reply(ctx, '❌ Please provide a valid amount');
		return;
	}

	category = args.slice(0, amountIndex).join(' ').replace(/["']/g, '').trim();
	
	if (!category) {
		await reply(ctx, '❌ Category cannot be empty\n\nUsage: /budget set [category] [amount] [period]');
		return;
	}
	
	const amount = parseFloat(args[amountIndex]);
	const period = args[amountIndex + 1]?.toLowerCase();

	if (!['daily', 'weekly', 'monthly'].includes(period)) {
		await reply(ctx, '❌ Period must be: daily, weekly, or monthly');
		return;
	}

	// Create or update budget
	await db.prepare(`
		INSERT OR REPLACE INTO budgets (user_id, category, amount, period)
		VALUES (?, ?, ?, ?)
	`).bind(userId, category, amount, period).run();

	const periodAbbrev = {
		'daily': '/day',
		'weekly': '/week', 
		'monthly': '/month'
	}[period] || period;
	
	await reply(ctx, 
		`✅ <b>Budget Set!</b>\n\n` +
		`📂 Category: ${category}\n` +
		`💵 Amount: $${amount.toFixed(2)}${periodAbbrev}\n\n` +
		`I'll track your ${category} expenses and notify you when you're close to your limit!`,
		{ parse_mode: 'HTML' }
	);
}

async function viewBudgets(ctx: Context, db: D1Database, userId: string): Promise<void> {
	await showBudgetMenu(ctx, db, userId);
}

async function deleteBudget(ctx: Context, db: D1Database, userId: string, args: string[]): Promise<void> {
	if (args.length === 0) {
		await reply(ctx, '❌ Please specify a category to delete\nExample: /budget delete "Food & Dining"');
		return;
	}

	const category = args.join(' ').replace(/["']/g, '');
	
	const result = await db.prepare(`
		DELETE FROM budgets 
		WHERE user_id = ? AND category = ?
	`).bind(userId, category).run();

	if (result.meta.changes > 0) {
		await reply(ctx, `✅ Budget for "${category}" has been removed.`);
	} else {
		await reply(ctx, `❌ No budget found for "${category}"`);
	}
}