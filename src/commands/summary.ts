import { Context } from 'grammy';

export async function handleSummary(ctx: Context, db: D1Database) {
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();
	
	if (isPersonal) {
		// Show personal monthly summary
		await handlePersonalSummary(ctx, db, userId!);
		return;
	}

	const message = ctx.message?.text || '';
	const args = message.split(' ').slice(1);
	const groupId = ctx.chat!.id.toString();
	const groupName = (ctx.chat as any).title || 'This Group';

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
			summaryMessage += `• Expenses: ${expenseCount} totaling $${(totalAmount as number).toFixed(2)}\n`;
			summaryMessage += `• Settlements: ${settlementCount} totaling $${(totalSettled as number).toFixed(2)}\n`;
			summaryMessage += `• Active days: ${activeDays}\n`;
			summaryMessage += `• Daily average: $${((totalAmount as number) / (activeDays as number)).toFixed(2)}\n\n`;

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
					const percentage = (((cat.total as number) / (totalAmount as number)) * 100).toFixed(1);
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

// Handle personal monthly summary
async function handlePersonalSummary(ctx: Context, db: D1Database, userId: string) {
	const message = ctx.message?.text || '';
	const args = message.split(' ').slice(1);

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
				COUNT(*) as total_expenses,
				SUM(amount) as total_amount,
				AVG(amount) as avg_amount
			FROM expenses
			WHERE paid_by = ? 
				AND is_personal = TRUE 
				AND deleted = FALSE
				AND created_at >= ?
				AND created_at <= ?
		`).bind(userId, startDate.toISOString(), endDate.toISOString()).first();

		// Get expenses by category
		const byCategory = await db.prepare(`
			SELECT 
				COALESCE(category, 'Uncategorized') as category,
				COUNT(*) as count,
				SUM(amount) as total
			FROM expenses
			WHERE paid_by = ? 
				AND is_personal = TRUE 
				AND deleted = FALSE
				AND created_at >= ?
				AND created_at <= ?
			GROUP BY category
			ORDER BY total DESC
		`).bind(userId, startDate.toISOString(), endDate.toISOString()).all();

		// Get daily average
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const dailyAverage = (expenseSummary?.total_amount as number || 0) / daysInMonth;

		// Build summary message
		let summaryMessage = `📊 <b>Personal Summary - ${monthName}</b>\n\n`;

		if (!expenseSummary || expenseSummary.total_expenses === 0) {
			summaryMessage += '🆕 No expenses recorded this month.\n\n';
			summaryMessage += 'Start tracking with:\n';
			summaryMessage += '<code>/add [amount] [description]</code>';
		} else {
			summaryMessage += `💵 <b>Total Spent:</b> $${(expenseSummary.total_amount as number).toFixed(2)}\n`;
			summaryMessage += `📋 <b>Total Expenses:</b> ${expenseSummary.total_expenses}\n`;
			summaryMessage += `📊 <b>Average per Expense:</b> $${(expenseSummary.avg_amount as number).toFixed(2)}\n`;
			summaryMessage += `📅 <b>Daily Average:</b> $${dailyAverage.toFixed(2)}\n\n`;

			if (byCategory.results.length > 0) {
				summaryMessage += '📂 <b>By Category:</b>\n';
				for (const cat of byCategory.results) {
					const percentage = (((cat.total as number) / (expenseSummary.total_amount as number)) * 100).toFixed(1);
					summaryMessage += `  • ${cat.category}: $${(cat.total as number).toFixed(2)} (${percentage}%)\n`;
				}
			}

			// Compare to previous month
			const prevMonth = new Date(year, month - 1, 1);
			const prevMonthEnd = new Date(year, month, 0, 23, 59, 59);
			const prevMonthData = await db.prepare(`
				SELECT SUM(amount) as total
				FROM expenses
				WHERE paid_by = ? 
					AND is_personal = TRUE 
					AND deleted = FALSE
					AND created_at >= ?
					AND created_at <= ?
			`).bind(userId, prevMonth.toISOString(), prevMonthEnd.toISOString()).first();

			if (prevMonthData && prevMonthData.total) {
				const diff = (expenseSummary.total_amount as number) - (prevMonthData.total as number);
				const percentChange = ((diff / (prevMonthData.total as number)) * 100).toFixed(1);
				summaryMessage += '\n📈 <b>vs Last Month:</b> ';
				if (diff > 0) {
					summaryMessage += `+$${diff.toFixed(2)} (+${percentChange}%)`;
				} else {
					summaryMessage += `$${diff.toFixed(2)} (${percentChange}%)`;
				}
			}
		}

		await ctx.reply(summaryMessage, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 Current Balance', callback_data: 'view_balance' }],
					[{ text: '📋 View Expenses', callback_data: 'view_personal_expenses' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }]
				]
			}
		});
	} catch (error) {
		console.error('Error generating personal summary:', error);
		await ctx.reply('❌ Error generating summary. Please try again.');
	}
}