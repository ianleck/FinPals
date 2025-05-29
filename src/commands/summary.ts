import { Context } from 'grammy';

export async function handleSummary(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const message = ctx.message?.text || '';
	const args = message.split(' ').slice(1);
	const groupId = ctx.chat.id.toString();
	const groupName = ctx.chat.title || 'This Group';

	// Parse month/year from arguments
	let targetDate = new Date();
	if (args.length > 0) {
		// Try to parse month (e.g., "03" or "march" or "2024-03")
		const monthArg = args[0].toLowerCase();
		const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
			'july', 'august', 'september', 'october', 'november', 'december'];
		
		if (monthArg.includes('-')) {
			// Format: YYYY-MM
			const [year, month] = monthArg.split('-');
			targetDate = new Date(parseInt(year), parseInt(month) - 1);
		} else if (monthNames.includes(monthArg)) {
			// Month name
			const monthIndex = monthNames.indexOf(monthArg);
			targetDate = new Date(targetDate.getFullYear(), monthIndex);
		} else if (!isNaN(parseInt(monthArg))) {
			// Month number
			const month = parseInt(monthArg);
			if (month >= 1 && month <= 12) {
				targetDate = new Date(targetDate.getFullYear(), month - 1);
			}
		}
	}

	const year = targetDate.getFullYear();
	const month = targetDate.getMonth();
	const monthName = targetDate.toLocaleDateString('en', { month: 'long', year: 'numeric' });
	
	// Calculate date range
	const startDate = new Date(year, month, 1);
	const endDate = new Date(year, month + 1, 0, 23, 59, 59);

	try {
		// Get expense summary
		const expenseSummary = await db.prepare(`
			SELECT 
				COUNT(*) as expense_count,
				SUM(amount) as total_amount,
				COUNT(DISTINCT paid_by) as unique_payers,
				COUNT(DISTINCT DATE(created_at)) as active_days
			FROM expenses
			WHERE group_id = ? 
				AND deleted = FALSE
				AND created_at >= ?
				AND created_at <= ?
		`).bind(groupId, startDate.toISOString(), endDate.toISOString()).first();

		// Get settlement summary
		const settlementSummary = await db.prepare(`
			SELECT 
				COUNT(*) as settlement_count,
				SUM(amount) as total_settled
			FROM settlements
			WHERE group_id = ?
				AND created_at >= ?
				AND created_at <= ?
		`).bind(groupId, startDate.toISOString(), endDate.toISOString()).first();

		// Get top spenders
		const topSpenders = await db.prepare(`
			SELECT 
				u.username,
				u.first_name,
				SUM(e.amount) as total_paid,
				COUNT(*) as expense_count
			FROM expenses e
			JOIN users u ON e.paid_by = u.telegram_id
			WHERE e.group_id = ? 
				AND e.deleted = FALSE
				AND e.created_at >= ?
				AND e.created_at <= ?
			GROUP BY e.paid_by
			ORDER BY total_paid DESC
			LIMIT 5
		`).bind(groupId, startDate.toISOString(), endDate.toISOString()).all();

		// Get category breakdown
		const categoryBreakdown = await db.prepare(`
			SELECT 
				COALESCE(category, 'Uncategorized') as category,
				COUNT(*) as count,
				SUM(amount) as total
			FROM expenses
			WHERE group_id = ? 
				AND deleted = FALSE
				AND created_at >= ?
				AND created_at <= ?
			GROUP BY category
			ORDER BY total DESC
		`).bind(groupId, startDate.toISOString(), endDate.toISOString()).all();

		// Format the summary
		const expenseCount = expenseSummary?.expense_count || 0;
		const totalAmount = expenseSummary?.total_amount || 0;
		const settlementCount = settlementSummary?.settlement_count || 0;
		const totalSettled = settlementSummary?.total_settled || 0;
		const activeDays = expenseSummary?.active_days || 0;

		let summaryMessage = `📅 <b>Monthly Summary - ${monthName}</b>\n`;
		summaryMessage += `📍 ${groupName}\n\n`;

		if (expenseCount === 0) {
			summaryMessage += '🔍 No expenses recorded for this month.\n\n';
			summaryMessage += 'Try a different month or start adding expenses!';
		} else {
			// Overview
			summaryMessage += `<b>📊 Overview</b>\n`;
			summaryMessage += `• Expenses: ${expenseCount} totaling $${totalAmount.toFixed(2)}\n`;
			summaryMessage += `• Settlements: ${settlementCount} totaling $${totalSettled.toFixed(2)}\n`;
			summaryMessage += `• Active days: ${activeDays}\n`;
			summaryMessage += `• Daily average: $${(totalAmount / activeDays).toFixed(2)}\n\n`;

			// Top spenders
			if (topSpenders.results.length > 0) {
				summaryMessage += `<b>🏆 Top Spenders</b>\n`;
				topSpenders.results.forEach((spender, index) => {
					const name = spender.username || spender.first_name || 'Unknown';
					const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  •';
					summaryMessage += `${medal} @${name}: $${(spender.total_paid as number).toFixed(2)} (${spender.expense_count}x)\n`;
				});
				summaryMessage += '\n';
			}

			// Category breakdown
			if (categoryBreakdown.results.length > 0) {
				summaryMessage += `<b>📂 Category Breakdown</b>\n`;
				categoryBreakdown.results.forEach(cat => {
					const percentage = ((cat.total as number / totalAmount) * 100).toFixed(1);
					summaryMessage += `• ${cat.category}: $${(cat.total as number).toFixed(2)} (${percentage}%)\n`;
				});
			}
		}

		await ctx.reply(summaryMessage, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 Current Balance', callback_data: 'view_balance' }],
					[{ text: '📈 View Stats', callback_data: 'view_stats' }],
					[{ text: '📥 Export Data', callback_data: 'export_csv' }]
				]
			}
		});
	} catch (error) {
		console.error('Error generating summary:', error);
		await ctx.reply('❌ Error generating summary. Please try again.');
	}
}