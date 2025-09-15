import { Context } from 'grammy';
import { eq, and, sql, desc } from 'drizzle-orm';
import { type Database, withRetry, parseDecimal } from '../db';
import { expenses, expenseSplits, settlements, users } from '../db/schema';

export async function handleStats(ctx: Context, db: Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const groupId = ctx.chat!.id.toString();
	const groupName = ctx.chat!.title || 'This Group';

	try {
		// Get overview statistics
		const overview = await withRetry(async () => {
			const result = await db
				.select({
					totalExpenses: sql<number>`COUNT(DISTINCT ${expenses.id})::int`,
					totalAmount: sql<string>`SUM(${expenses.amount})`,
					activePayers: sql<number>`COUNT(DISTINCT ${expenses.paidBy})::int`,
					activeDays: sql<number>`COUNT(DISTINCT DATE(${expenses.createdAt}))::int`,
					firstExpenseDate: sql<Date>`MIN(${expenses.createdAt})`,
				})
				.from(expenses)
				.where(and(eq(expenses.groupId, groupId), eq(expenses.deleted, false)));
			return result[0];
		});

		// Get active participants count
		const participants = await withRetry(async () => {
			const result = await db
				.select({
					activeParticipants: sql<number>`COUNT(DISTINCT ${expenseSplits.userId})::int`,
				})
				.from(expenseSplits)
				.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
				.where(and(eq(expenses.groupId, groupId), eq(expenses.deleted, false)));
			return result[0];
		});

		// Get settlement statistics
		const settlementStats = await withRetry(async () => {
			const result = await db
				.select({
					totalSettlements: sql<number>`COUNT(*)::int`,
					totalSettled: sql<string>`SUM(${settlements.amount})`,
				})
				.from(settlements)
				.where(eq(settlements.groupId, groupId));
			return result[0];
		});

		// Get top spender
		const topSpender = await withRetry(async () => {
			const result = await db
				.select({
					username: users.username,
					firstName: users.firstName,
					totalPaid: sql<string>`SUM(${expenses.amount})`,
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(and(eq(expenses.groupId, groupId), eq(expenses.deleted, false)))
				.groupBy(expenses.paidBy, users.username, users.firstName)
				.orderBy(desc(sql`SUM(${expenses.amount})`))
				.limit(1);
			return result[0];
		});

		// Get category breakdown
		const categoryBreakdown = await withRetry(async () => {
			return await db
				.select({
					category: sql<string>`COALESCE(${expenses.category}, 'Other')`,
					count: sql<number>`COUNT(*)::int`,
					total: sql<string>`SUM(${expenses.amount})`,
				})
				.from(expenses)
				.where(and(eq(expenses.groupId, groupId), eq(expenses.deleted, false)))
				.groupBy(expenses.category)
				.orderBy(desc(sql`SUM(${expenses.amount})`))
				.limit(5);
		});

		// Format the statistics message
		const totalExpenses = overview?.totalExpenses || 0;
		const totalAmount = parseDecimal(overview?.totalAmount || '0');
		const totalSettled = parseDecimal(settlementStats?.totalSettled || '0');
		const firstDate = overview?.firstExpenseDate ? new Date(overview.firstExpenseDate).toLocaleDateString() : 'N/A';

		let message = `📊 <b>Statistics for ${groupName}</b>\n\n`;

		if (totalExpenses === 0) {
			message += 'No expenses recorded yet!\n\nStart with /add [amount] [description]';
		} else {
			message += `<b>Overview:</b>\n`;
			message += `📝 Total Expenses: ${totalExpenses}\n`;
			message += `💵 Total Amount: $${totalAmount.toFixed(2)}\n`;
			message += `💸 Total Settled: $${totalSettled.toFixed(2)}\n`;
			message += `📅 Tracking Since: ${firstDate}\n`;
			message += `👥 Active Members: ${participants?.activeParticipants || 0}\n\n`;

			if (topSpender) {
				const spenderName = topSpender.username || topSpender.firstName || 'Unknown';
				const topAmount = parseDecimal(topSpender.totalPaid);
				message += `<b>Top Spender:</b>\n`;
				message += `🏆 @${spenderName} - $${topAmount.toFixed(2)}\n\n`;
			}

			if (categoryBreakdown.length > 0) {
				message += `<b>Top Categories:</b>\n`;
				for (const cat of categoryBreakdown) {
					const catTotal = parseDecimal(cat.total);
					message += `${cat.category}: $${catTotal.toFixed(2)} (${cat.count}x)\n`;
				}
			}
		}

		// Send stats message
		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📈 View Trends', callback_data: 'view_trends' }],
					[{ text: '📊 View Balance', callback_data: 'view_balance' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }],
				],
			},
		});
	} catch {
		await ctx.reply('❌ Error getting statistics. Please try again.');
	}
}
