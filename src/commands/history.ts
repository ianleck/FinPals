import { Context } from 'grammy';

export async function handleHistory(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const groupId = ctx.chat.id.toString();

	try {
		// Get recent transactions (expenses and settlements)
		const recentTransactions = await db.prepare(`
			SELECT * FROM (
				SELECT 
					'expense' as type,
					e.id,
					e.amount,
					e.currency,
					e.description,
					e.category,
					e.created_at,
					u.username as user_username,
					u.first_name as user_first_name,
					NULL as to_username,
					NULL as to_first_name
				FROM expenses e
				JOIN users u ON e.paid_by = u.telegram_id
				WHERE e.group_id = ? AND e.deleted = FALSE
				
				UNION ALL
				
				SELECT 
					'settlement' as type,
					s.id,
					s.amount,
					s.currency,
					'Settlement' as description,
					NULL as category,
					s.created_at,
					u1.username as user_username,
					u1.first_name as user_first_name,
					u2.username as to_username,
					u2.first_name as to_first_name
				FROM settlements s
				JOIN users u1 ON s.from_user = u1.telegram_id
				JOIN users u2 ON s.to_user = u2.telegram_id
				WHERE s.group_id = ?
			) as transactions
			ORDER BY created_at DESC
			LIMIT 20
		`).bind(groupId, groupId).all();

		if (!recentTransactions.results || recentTransactions.results.length === 0) {
			await ctx.reply(
				'📭 <b>No Transaction History</b>\n\n' +
				'No expenses or settlements recorded yet.\n\n' +
				'Start by adding an expense with /add',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Format transactions
		let message = '📜 <b>Recent Transactions</b>\n\n';

		for (const tx of recentTransactions.results) {
			const date = new Date(tx.created_at as string).toLocaleDateString();
			const userName = tx.user_username || tx.user_first_name || 'Unknown';

			if (tx.type === 'expense') {
				// Get split info for expense
				const splits = await db.prepare(
					'SELECT COUNT(*) as count FROM expense_splits WHERE expense_id = ?'
				).bind(tx.id).first();
				const splitCount = splits?.count || 1;

				message += `💵 <b>${date}</b> - ${tx.description}\n`;
				message += `   $${(tx.amount as number).toFixed(2)} by @${userName} (${splitCount} people)\n\n`;
			} else {
				// Settlement
				const toUserName = tx.to_username || tx.to_first_name || 'Unknown';
				message += `💰 <b>${date}</b>\n`;
				message += `   @${userName} → @${toUserName}: $${(tx.amount as number).toFixed(2)}\n\n`;
			}
		}

		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 View Balance', callback_data: 'view_balance' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }]
				]
			}
		});
	} catch (error) {
		console.error('Error getting history:', error);
		await ctx.reply('❌ Error retrieving transaction history. Please try again.');
	}
}