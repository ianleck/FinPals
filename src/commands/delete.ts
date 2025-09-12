import { Context } from 'grammy';
import { eq, and, desc } from 'drizzle-orm';
import { type Database, withRetry, parseDecimal } from '../db';
import { expenses, users } from '../db/schema';
import { ERROR_MESSAGES } from '../utils/constants';

export async function handleDelete(ctx: Context, db: Database) {
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
			const recentExpenses = await withRetry(async () => {
				return await db
					.select({
						id: expenses.id,
						description: expenses.description,
						amount: expenses.amount,
						createdBy: expenses.createdBy,
						currency: expenses.currency,
						createdAt: expenses.createdAt,
						username: users.username,
						firstName: users.firstName
					})
					.from(expenses)
					.innerJoin(users, eq(expenses.createdBy, users.telegramId))
					.where(
						and(
							eq(expenses.groupId, groupId),
							eq(expenses.deleted, false)
						)
					)
					.orderBy(desc(expenses.createdAt))
					.limit(10);
			});

			if (!recentExpenses || recentExpenses.length === 0) {
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
			
			recentExpenses.forEach((expense) => {
				const creatorName = expense.username ? `@${expense.username}` : expense.firstName || 'Unknown';
				const date = new Date(expense.createdAt).toLocaleDateString();
				const canDelete = expense.createdBy === userId || isAdmin;
				const deleteIcon = canDelete ? ' ✅' : '';
				const amount = parseDecimal(expense.amount);
				
				message += `<code>${expense.id}</code> - ${expense.description}\n`;
				message += `   💰 ${expense.currency}${amount.toFixed(2)} by ${creatorName}${deleteIcon}\n`;
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
		const expense = await withRetry(async () => {
			const result = await db
				.select({
					id: expenses.id,
					description: expenses.description,
					amount: expenses.amount,
					createdBy: expenses.createdBy,
					username: users.username,
					firstName: users.firstName
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.createdBy, users.telegramId))
				.where(
					and(
						eq(expenses.id, expenseId),
						eq(expenses.groupId, groupId),
						eq(expenses.deleted, false)
					)
				)
				.limit(1);
			return result[0];
		});

		if (!expense) {
			await ctx.reply('❌ Expense not found or already deleted.');
			return;
		}

		// Only allow creator or admins to delete
		const isCreator = expense.createdBy === userId;
		let isAdmin = false;

		try {
			const member = await ctx.getChatMember(parseInt(userId));
			isAdmin = member.status === 'administrator' || member.status === 'creator';
		} catch {
			// Ignore permission check errors
		}

		if (!isCreator && !isAdmin) {
			const creatorName = expense.username || expense.firstName || 'Unknown';
			await ctx.reply(
				`❌ Only @${creatorName} (who created this expense) or group admins can delete it.`
			);
			return;
		}

		// Soft delete the expense
		await withRetry(async () => {
			await db
				.update(expenses)
				.set({ deleted: true })
				.where(eq(expenses.id, expenseId));
		});

		const amount = parseDecimal(expense.amount);
		await ctx.reply(
			`✅ <b>Expense Deleted</b>\n\n` +
			`"${expense.description}" - $${amount.toFixed(2)}\n\n` +
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