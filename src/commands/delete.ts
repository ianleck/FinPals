import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';

export async function handleDelete(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const message = ctx.message?.text || '';
	const args = message.split(/[\s_]+/).slice(1); // Handle both /delete id and /delete_id formats
	const groupId = ctx.chat!.id.toString();
	const userId = ctx.from!.id.toString();

	// If no args provided, show recent expenses to choose from
	if (args.length === 0) {
		try {
			// Get recent expenses
			const recentExpenses = await db.prepare(`
				SELECT 
					e.id,
					e.description,
					e.amount,
					e.created_by,
					e.currency,
					e.created_at,
					u.username,
					u.first_name
				FROM expenses e
				JOIN users u ON e.created_by = u.telegram_id
				WHERE e.group_id = ? AND e.deleted = FALSE
				ORDER BY e.created_at DESC
				LIMIT 10
			`).bind(groupId).all();

			if (!recentExpenses.results || recentExpenses.results.length === 0) {
				await ctx.reply('📭 No expenses found in this group.');
				return;
			}

			// Check if user is admin
			let isAdmin = false;
			try {
				const member = await ctx.getChatMember(parseInt(userId));
				isAdmin = member.status === 'administrator' || member.status === 'creator';
			} catch {
				// Ignore permission check errors
			}

			// Format the list of recent expenses
			let message = '🗑️ <b>Select an expense to delete:</b>\n\n';
			const buttons: any[][] = [];
			
			recentExpenses.results.forEach((expense: any) => {
				const creatorName = expense.username ? `@${expense.username}` : expense.first_name || 'Unknown';
				const date = new Date(expense.created_at).toLocaleDateString();
				const canDelete = expense.created_by === userId || isAdmin;
				const deleteIcon = canDelete ? ' ✅' : '';
				
				message += `<code>${expense.id}</code> - ${expense.description}\n`;
				message += `   💰 ${expense.currency}${expense.amount.toFixed(2)} by ${creatorName}${deleteIcon}\n`;
				message += `   📅 ${date}\n\n`;
				
				// Add delete button if user can delete this expense
				if (canDelete) {
					buttons.push([{
						text: `🗑️ ${expense.id}: ${expense.description.substring(0, 20)}${expense.description.length > 20 ? '...' : ''}`,
						callback_data: `delete_${expense.id}`
					}]);
				}
			});

			message += '💡 <i>Use:</i> <code>/delete [ID]</code> <i>to delete</i>\n';
			message += '✅ <i>= You can delete this expense</i>';

			const replyOptions: any = { parse_mode: 'HTML' };
			if (buttons.length > 0) {
				replyOptions.reply_markup = {
					inline_keyboard: buttons
				};
			}

			await ctx.reply(message, replyOptions);
			return;
		} catch (error) {
			console.error('Error fetching recent expenses:', error);
			await ctx.reply(ERROR_MESSAGES.DATABASE_ERROR);
			return;
		}
	}

	const expenseId = args[0];

	try {
		// Check if expense exists and user has permission to delete
		const expense = await db.prepare(`
			SELECT 
				e.id, 
				e.description, 
				e.amount,
				e.created_by,
				u.username,
				u.first_name
			FROM expenses e
			JOIN users u ON e.created_by = u.telegram_id
			WHERE e.id = ? AND e.group_id = ? AND e.deleted = FALSE
		`).bind(expenseId, groupId).first();

		if (!expense) {
			await ctx.reply('❌ Expense not found or already deleted.');
			return;
		}

		// Only allow creator or admins to delete
		const isCreator = expense.created_by === userId;
		let isAdmin = false;

		try {
			const member = await ctx.getChatMember(parseInt(userId));
			isAdmin = member.status === 'administrator' || member.status === 'creator';
		} catch {
			// Ignore permission check errors
		}

		if (!isCreator && !isAdmin) {
			const creatorName = expense.username || expense.first_name || 'Unknown';
			await ctx.reply(
				`❌ Only @${creatorName} (who created this expense) or group admins can delete it.`
			);
			return;
		}

		// Soft delete the expense
		await db.prepare(
			'UPDATE expenses SET deleted = TRUE WHERE id = ?'
		).bind(expenseId).run();

		await ctx.reply(
			`✅ <b>Expense Deleted</b>\n\n` +
			`"${expense.description}" - $${(expense.amount as number).toFixed(2)}\n\n` +
			`The balances have been updated.`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{ text: '📊 View Balance', callback_data: 'view_balance' }],
						[{ text: '📜 View History', callback_data: 'view_history' }]
					]
				}
			}
		);
	} catch (error) {
		console.error('Error deleting expense:', error);
		await ctx.reply(ERROR_MESSAGES.DATABASE_ERROR);
	}
}