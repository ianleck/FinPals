import { Context } from 'grammy';

// HTML escape function to prevent parsing errors
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

export async function handlePersonal(ctx: Context, db: D1Database) {
	// Only work in private chats
	if (ctx.chat?.type !== 'private') {
		await ctx.reply('⚠️ Personal expense tracking only works in private chats. DM me directly!');
		return;
	}

	const userId = ctx.from!.id.toString();

	try {
		// Get all user's balances across groups
		const balances = await db.prepare(`
			WITH user_balances AS (
				-- Money owed to the user
				SELECT 
					g.telegram_id as group_id,
					g.title as group_name,
					e.paid_by as creditor,
					es.user_id as debtor,
					SUM(es.amount) as amount
				FROM expenses e
				JOIN expense_splits es ON e.id = es.expense_id
				JOIN groups g ON e.group_id = g.telegram_id
				WHERE e.deleted = FALSE
					AND (e.paid_by = ? OR es.user_id = ?)
				GROUP BY g.telegram_id, g.title, e.paid_by, es.user_id
				
				UNION ALL
				
				-- Settlements
				SELECT 
					g.telegram_id as group_id,
					g.title as group_name,
					s.to_user as creditor,
					s.from_user as debtor,
					-s.amount as amount
				FROM settlements s
				JOIN groups g ON s.group_id = g.telegram_id
				WHERE s.from_user = ? OR s.to_user = ?
			)
			SELECT 
				group_id,
				group_name,
				SUM(CASE 
					WHEN creditor = ? AND debtor != ? THEN amount
					WHEN debtor = ? AND creditor != ? THEN -amount
					ELSE 0
				END) as net_balance
			FROM user_balances
			WHERE creditor != debtor
			GROUP BY group_id, group_name
			HAVING ABS(net_balance) > 0.01
			ORDER BY ABS(net_balance) DESC
		`).bind(userId, userId, userId, userId, userId, userId, userId, userId).all();

		// Get spending summary
		const spending = await db.prepare(`
			SELECT 
				g.title as group_name,
				COUNT(DISTINCT e.id) as expense_count,
				SUM(e.amount) as total_paid,
				AVG(e.amount) as avg_expense
			FROM expenses e
			JOIN groups g ON e.group_id = g.telegram_id
			WHERE e.paid_by = ? AND e.deleted = FALSE
			GROUP BY g.telegram_id
			ORDER BY total_paid DESC
		`).bind(userId).all();

		// Get category breakdown across all groups
		const categories = await db.prepare(`
			SELECT 
				COALESCE(category, 'Uncategorized') as category,
				COUNT(*) as count,
				SUM(amount) as total,
				FALSE as is_personal
			FROM expenses
			WHERE created_by = ? AND deleted = FALSE AND is_personal = FALSE
			GROUP BY category
			ORDER BY total DESC
		`).bind(userId).all();

		// Get personal expenses summary
		const personalExpenses = await db.prepare(`
			SELECT 
				COUNT(*) as expense_count,
				SUM(amount) as total_amount,
				AVG(amount) as avg_amount
			FROM expenses
			WHERE paid_by = ? AND is_personal = TRUE AND deleted = FALSE
		`).bind(userId).first();

		// Get personal expenses by category
		const personalCategories = await db.prepare(`
			SELECT 
				COALESCE(category, 'Uncategorized') as category,
				COUNT(*) as count,
				SUM(amount) as total
			FROM expenses
			WHERE paid_by = ? AND is_personal = TRUE AND deleted = FALSE
			GROUP BY category
			ORDER BY total DESC
		`).bind(userId).all();

		// Format the response
		let message = `👤 <b>Your Personal Summary</b>\n\n`;

		// Balances section
		if (balances.results.length > 0) {
			message += `💰 <b>Balances Across Groups:</b>\n`;
			let totalOwed = 0;
			let totalOwing = 0;

			for (const balance of balances.results) {
				const amount = balance.net_balance as number;
				if (amount > 0) {
					message += `✅ ${escapeHtml(balance.group_name as string)}: You're owed $${amount.toFixed(2)}\n`;
					totalOwed += amount;
				} else {
					message += `❌ ${escapeHtml(balance.group_name as string)}: You owe $${Math.abs(amount).toFixed(2)}\n`;
					totalOwing += Math.abs(amount);
				}
			}

			message += `\n📊 <b>Summary:</b>\n`;
			message += `• Total owed to you: $${totalOwed.toFixed(2)}\n`;
			message += `• Total you owe: $${totalOwing.toFixed(2)}\n`;
			message += `• Net balance: $${(totalOwed - totalOwing).toFixed(2)}\n\n`;
		} else {
			message += `✨ You're all settled up across all groups!\n\n`;
		}

		// Spending section
		if (spending.results.length > 0) {
			message += `💳 <b>Your Spending by Group:</b>\n`;
			let totalSpent = 0;

			for (const group of spending.results) {
				const total = group.total_paid as number;
				totalSpent += total;
				message += `• ${escapeHtml(group.group_name as string)}: $${total.toFixed(2)} (${group.expense_count} expenses)\n`;
			}

			message += `\nTotal spent: $${totalSpent.toFixed(2)}\n\n`;
		}

		// Category breakdown
		if (categories.results.length > 0) {
			message += `📂 <b>Group Spending by Category:</b>\n`;
			const totalCategorized = categories.results.reduce((sum, cat) => sum + (cat.total as number), 0);

			for (const cat of categories.results) {
				const percentage = ((cat.total as number / totalCategorized) * 100).toFixed(1);
				message += `• ${escapeHtml(cat.category as string)}: $${(cat.total as number).toFixed(2)} (${percentage}%)\n`;
			}
			message += '\n';
		}

		// Personal expenses section
		if (personalExpenses && (personalExpenses.expense_count as number) > 0) {
			message += `💳 <b>Personal Expense Tracking:</b>\n`;
			message += `• Total expenses: ${personalExpenses.expense_count}\n`;
			message += `• Total spent: $${(personalExpenses.total_amount as number).toFixed(2)}\n`;
			message += `• Average expense: $${(personalExpenses.avg_amount as number).toFixed(2)}\n\n`;

			if (personalCategories.results.length > 0) {
				message += `📂 <b>Personal Spending by Category:</b>\n`;
				const totalPersonal = personalCategories.results.reduce((sum, cat) => sum + (cat.total as number), 0);

				for (const cat of personalCategories.results) {
					const percentage = ((cat.total as number / totalPersonal) * 100).toFixed(1);
					message += `• ${escapeHtml(cat.category as string)}: $${(cat.total as number).toFixed(2)} (${percentage}%)\n`;
				}
			}
		}

		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📥 Export All Data', callback_data: 'export_personal' }],
					[{ text: '📊 Monthly Report', callback_data: 'personal_monthly' }]
				]
			}
		});
	} catch (error) {
		console.error('Error getting personal summary:', error);
		await ctx.reply('❌ Error loading personal summary. Please try again.');
	}
}