import { Context } from 'grammy';

export async function handleExport(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const groupId = ctx.chat.id.toString();
	const groupName = ctx.chat.title || 'Group';

	try {
		// Get all expenses with full details
		const expenses = await db.prepare(`
			SELECT 
				e.id,
				e.amount,
				e.currency,
				e.description,
				e.category,
				e.created_at,
				u.username as payer_username,
				u.first_name as payer_first_name,
				u.telegram_id as payer_id
			FROM expenses e
			JOIN users u ON e.paid_by = u.telegram_id
			WHERE e.group_id = ? AND e.deleted = FALSE
			ORDER BY e.created_at DESC
		`).bind(groupId).all();

		// Get all settlements
		const settlements = await db.prepare(`
			SELECT 
				s.id,
				s.amount,
				s.currency,
				s.created_at,
				u1.username as from_username,
				u1.first_name as from_first_name,
				u2.username as to_username,
				u2.first_name as to_first_name
			FROM settlements s
			JOIN users u1 ON s.from_user = u1.telegram_id
			JOIN users u2 ON s.to_user = u2.telegram_id
			WHERE s.group_id = ?
			ORDER BY s.created_at DESC
		`).bind(groupId).all();

		if ((!expenses.results || expenses.results.length === 0) && 
			(!settlements.results || settlements.results.length === 0)) {
			await ctx.reply('📭 No data to export. Start by adding expenses with /add');
			return;
		}

		// Create CSV content
		let csvContent = 'Type,Date,Description,Amount,Currency,Paid By,Split With,Category\n';

		// Add expenses
		for (const expense of expenses.results || []) {
			// Get split participants
			const splits = await db.prepare(`
				SELECT u.username, u.first_name
				FROM expense_splits es
				JOIN users u ON es.user_id = u.telegram_id
				WHERE es.expense_id = ?
			`).bind(expense.id).all();

			const participants = splits.results.map(s => 
				s.username || s.first_name || 'Unknown'
			).join('; ');

			const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
			const date = new Date(expense.created_at as string).toLocaleDateString();
			
			csvContent += `Expense,${date},"${expense.description}",${expense.amount},${expense.currency},"${payerName}","${participants}","${expense.category || 'Uncategorized'}"\n`;
		}

		// Add settlements
		for (const settlement of settlements.results || []) {
			const fromName = settlement.from_username || settlement.from_first_name || 'Unknown';
			const toName = settlement.to_username || settlement.to_first_name || 'Unknown';
			const date = new Date(settlement.created_at as string).toLocaleDateString();
			
			csvContent += `Settlement,${date},"Payment from ${fromName} to ${toName}",${settlement.amount},${settlement.currency},"${fromName}","${toName}","Settlement"\n`;
		}

		// Also create a summary
		const totalExpenses = expenses.results?.reduce((sum, e) => sum + (e.amount as number), 0) || 0;
		const totalSettlements = settlements.results?.reduce((sum, s) => sum + (s.amount as number), 0) || 0;

		const summary = `📊 <b>Export Summary - ${groupName}</b>\n\n` +
			`📝 Total Expenses: ${expenses.results?.length || 0} ($${totalExpenses.toFixed(2)})\n` +
			`💰 Total Settlements: ${settlements.results?.length || 0} ($${totalSettlements.toFixed(2)})\n\n` +
			`The CSV data is below. Copy and save it as a .csv file to open in Excel or Google Sheets.`;

		// Send as text file-like message
		await ctx.reply(summary, { parse_mode: 'HTML' });
		
		// Send CSV content in code block for easy copying
		await ctx.reply(
			'```\n' + csvContent + '\n```',
			{ 
				parse_mode: 'Markdown',
				reply_markup: {
					inline_keyboard: [
						[{ text: '📊 View Balance', callback_data: 'view_balance' }],
						[{ text: '📊 View Stats', callback_data: 'view_stats' }]
					]
				}
			}
		);
	} catch (error) {
		console.error('Error exporting data:', error);
		await ctx.reply('❌ Error exporting data. Please try again.');
	}
}