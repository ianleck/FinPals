import { Context } from 'grammy';
import { generateSpendingTrends, formatTrendsMessage } from '../utils/spending-visualization';

export async function handleStats(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const groupId = ctx.chat!.id.toString();
	const groupName = ctx.chat!.title || 'This Group';

	try {
		// Get various statistics
		const stats = await db.prepare(`
			SELECT 
				COUNT(DISTINCT e.id) as total_expenses,
				SUM(e.amount) as total_amount,
				COUNT(DISTINCT e.paid_by) as active_payers,
				COUNT(DISTINCT es.user_id) as active_participants,
				COUNT(DISTINCT DATE(e.created_at)) as active_days,
				MIN(e.created_at) as first_expense_date
			FROM expenses e
			JOIN expense_splits es ON e.id = es.expense_id
			WHERE e.group_id = ? AND e.deleted = FALSE
		`).bind(groupId).first();

		const settlements = await db.prepare(`
			SELECT 
				COUNT(*) as total_settlements,
				SUM(amount) as total_settled
			FROM settlements
			WHERE group_id = ?
		`).bind(groupId).first();

		const topSpender = await db.prepare(`
			SELECT 
				u.username,
				u.first_name,
				SUM(e.amount) as total_paid
			FROM expenses e
			JOIN users u ON e.paid_by = u.telegram_id
			WHERE e.group_id = ? AND e.deleted = FALSE
			GROUP BY e.paid_by
			ORDER BY total_paid DESC
			LIMIT 1
		`).bind(groupId).first();

		const categoryBreakdown = await db.prepare(`
			SELECT 
				COALESCE(category, 'Other') as category,
				COUNT(*) as count,
				SUM(amount) as total
			FROM expenses
			WHERE group_id = ? AND deleted = FALSE
			GROUP BY category
			ORDER BY total DESC
			LIMIT 5
		`).bind(groupId).all();

		// Format the statistics message
		const totalExpenses = stats?.total_expenses || 0;
		const totalAmount = Number(stats?.total_amount) || 0;
		const totalSettled = Number(settlements?.total_settled) || 0;
		const firstDate = stats?.first_expense_date ? new Date(stats.first_expense_date as string).toLocaleDateString() : 'N/A';

		let message = `📊 <b>Statistics for ${groupName}</b>\n\n`;
		
		if (totalExpenses === 0) {
			message += 'No expenses recorded yet!\n\nStart with /add [amount] [description]';
		} else {
			message += `<b>Overview:</b>\n`;
			message += `📝 Total Expenses: ${totalExpenses}\n`;
			message += `💵 Total Amount: $${totalAmount.toFixed(2)}\n`;
			message += `💸 Total Settled: $${totalSettled.toFixed(2)}\n`;
			message += `📅 Tracking Since: ${firstDate}\n`;
			message += `👥 Active Members: ${stats?.active_participants || 0}\n\n`;

			if (topSpender) {
				const spenderName = topSpender.username || topSpender.first_name || 'Unknown';
				message += `<b>Top Spender:</b>\n`;
				message += `🏆 @${spenderName} - $${(topSpender.total_paid as number).toFixed(2)}\n\n`;
			}

			if (categoryBreakdown.results.length > 0) {
				message += `<b>Top Categories:</b>\n`;
				for (const cat of categoryBreakdown.results) {
					message += `${cat.category}: $${(cat.total as number).toFixed(2)} (${cat.count}x)\n`;
				}
			}
		}

		// Send initial stats message
		const statsMsg = await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📈 View Trends', callback_data: 'view_trends' }],
					[{ text: '📊 View Balance', callback_data: 'view_balance' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }]
				]
			}
		});
	} catch (error) {
		console.error('Error getting stats:', error);
		await ctx.reply('❌ Error getting statistics. Please try again.');
	}
}