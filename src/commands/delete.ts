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

	if (args.length === 0) {
		await ctx.reply(
			'❌ Please provide an expense ID to delete.\n\n' +
			'Usage: /delete [expense_id]\n' +
			'Find expense IDs using /expenses',
			{ parse_mode: 'HTML' }
		);
		return;
	}

	const expenseId = args[0];
	const groupId = ctx.chat.id.toString();
	const userId = ctx.from!.id.toString();

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
			const member = await ctx.getChatMember(userId);
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