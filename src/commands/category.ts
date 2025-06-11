import { Context } from 'grammy';
import { EXPENSE_CATEGORIES, ERROR_MESSAGES } from '../utils/constants';

export async function handleCategory(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const message = ctx.message?.text || '';
	const args = message.split(' ').slice(1);

	if (args.length < 2) {
		const categoryList = EXPENSE_CATEGORIES.map((cat, i) => `${i + 1}. ${cat}`).join('\n');
		await ctx.reply(
			'❌ Invalid format!\n\n' +
			'Usage: /category [expense_id] [category]\n' +
			'Example: /category abc123 Food & Dining\n\n' +
			'<b>Available categories:</b>\n' +
			categoryList,
			{ parse_mode: 'HTML' }
		);
		return;
	}

	const expenseId = args[0];
	const category = args.slice(1).join(' ');
	const groupId = ctx.chat!.id.toString();

	// Validate category
	if (!EXPENSE_CATEGORIES.includes(category)) {
		const categoryList = EXPENSE_CATEGORIES.map((cat, i) => `${i + 1}. ${cat}`).join('\n');
		await ctx.reply(
			`❌ Invalid category: "${category}"\n\n` +
			'<b>Available categories:</b>\n' +
			categoryList,
			{ parse_mode: 'HTML' }
		);
		return;
	}

	try {
		// Check if expense exists
		const expense = await db.prepare(`
			SELECT id, description, amount, category
			FROM expenses
			WHERE id = ? AND group_id = ? AND deleted = FALSE
		`).bind(expenseId, groupId).first();

		if (!expense) {
			await ctx.reply('❌ Expense not found.');
			return;
		}

		// Update category
		await db.prepare(
			'UPDATE expenses SET category = ? WHERE id = ?'
		).bind(category, expenseId).run();

		// Store category mapping for future AI suggestions
		await db.prepare(`
			INSERT INTO category_mappings (description_pattern, category, confidence)
			VALUES (?, ?, 1.0)
			ON CONFLICT(description_pattern) DO UPDATE SET
				category = excluded.category,
				usage_count = usage_count + 1,
				confidence = MIN(1.0, confidence + 0.1)
		`).bind(expense.description?.toString().toLowerCase() || '', category).run();

		await ctx.reply(
			`✅ <b>Category Updated</b>\n\n` +
			`"${expense.description}" - $${(expense.amount as number).toFixed(2)}\n` +
			`Category: ${expense.category || 'None'} → <b>${category}</b>`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{ text: '📋 View All Expenses', callback_data: 'view_expenses' }],
						[{ text: '📊 View Stats', callback_data: 'view_stats' }]
					]
				}
			}
		);
	} catch (error) {
		console.error('Error updating category:', error);
		await ctx.reply(ERROR_MESSAGES.DATABASE_ERROR);
	}
}