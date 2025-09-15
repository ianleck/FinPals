import { Context } from 'grammy';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { type Database, withRetry } from '../db';
import { expenses, settlements, users, expenseSplits } from '../db/schema';
import { Money, formatMoney } from '../utils/money';
import { logger } from '../utils/logger';

export async function handleHistory(ctx: Context, db: Database) {
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();

	if (isPersonal) {
		// Show personal transaction history
		await handlePersonalHistory(ctx, db, userId!);
		return;
	}

	const groupId = ctx.chat!.id.toString();

	try {
		// Get recent expenses
		const recentExpenses = await withRetry(async () => {
			return await db
				.select({
					type: sql<string>`'expense'`,
					id: expenses.id,
					amount: expenses.amount,
					currency: expenses.currency,
					description: expenses.description,
					category: expenses.category,
					createdAt: expenses.createdAt,
					userUsername: users.username,
					userFirstName: users.firstName,
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(and(eq(expenses.groupId, groupId), eq(expenses.deleted, false)))
				.orderBy(desc(expenses.createdAt))
				.limit(20);
		});

		// Get recent settlements
		const recentSettlements = await withRetry(async () => {
			return await db
				.select({
					type: sql<string>`'settlement'`,
					id: settlements.id,
					amount: settlements.amount,
					currency: sql<string>`'USD'`,
					description: sql<string>`'Settlement'`,
					category: sql<string>`NULL`,
					createdAt: settlements.createdAt,
					fromUsername: users.username,
					fromFirstName: users.firstName,
					toUserId: settlements.toUser,
				})
				.from(settlements)
				.innerJoin(users, eq(settlements.fromUser, users.telegramId))
				.where(eq(settlements.groupId, groupId))
				.orderBy(desc(settlements.createdAt))
				.limit(20);
		});

		// Get usernames for settlement recipients
		const toUserIds = recentSettlements.map((s) => s.toUserId);
		const toUsers =
			toUserIds.length > 0
				? await withRetry(async () => {
						return await db
							.select({
								telegramId: users.telegramId,
								username: users.username,
								firstName: users.firstName,
							})
							.from(users)
							.where(toUserIds.length > 0 ? inArray(users.telegramId, toUserIds) : sql`1=0`);
					})
				: [];

		const toUserMap = new Map(toUsers.map((u) => [u.telegramId, u]));

		// Combine and sort transactions
		const allTransactions = [
			...recentExpenses.map((e) => ({
				...e,
				toUsername: null as string | null,
				toFirstName: null as string | null,
			})),
			...recentSettlements.map((s) => {
				const toUser = toUserMap.get(s.toUserId);
				return {
					...s,
					userUsername: s.fromUsername,
					userFirstName: s.fromFirstName,
					toUsername: toUser?.username || null,
					toFirstName: toUser?.firstName || null,
				};
			}),
		]
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
			.slice(0, 20);

		if (allTransactions.length === 0) {
			await ctx.reply(
				'📭 <b>No Transaction History</b>\n\n' + 'No expenses or settlements recorded yet.\n\n' + 'Start by adding an expense with /add',
				{ parse_mode: 'HTML' },
			);
			return;
		}

		// Format transactions
		let message = '📜 <b>Recent Transactions</b>\n\n';

		for (const tx of allTransactions) {
			const date = new Date(tx.createdAt).toLocaleDateString();
			const userName = tx.userUsername || tx.userFirstName || 'Unknown';
			const amount = Money.fromDatabase(tx.amount);

			if (tx.type === 'expense') {
				// Get split count for expense
				const splits = await withRetry(async () => {
					const result = await db
						.select({ count: sql<number>`COUNT(*)::int` })
						.from(expenseSplits)
						.where(eq(expenseSplits.expenseId, tx.id));
					return result[0];
				});
				const splitCount = splits?.count || 1;

				message += `💵 <b>${date}</b> - ${tx.description}\n`;
				message += `   ${formatMoney(amount)} by @${userName} (${splitCount} people)\n\n`;
			} else {
				// Settlement
				const toUserName = tx.toUsername || tx.toFirstName || 'Unknown';
				message += `💰 <b>${date}</b>\n`;
				message += `   @${userName} → @${toUserName}: ${formatMoney(amount)}\n\n`;
			}
		}

		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 View Balance', callback_data: 'view_balance' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }],
				],
			},
		});
	} catch (error) {
		logger.error('Error getting history', error);
		await ctx.reply('❌ Error retrieving transaction history. Please try again.');
	}
}

// Handle personal transaction history
async function handlePersonalHistory(ctx: Context, db: Database, userId: string) {
	try {
		// Get recent personal expenses
		const recentTransactions = await withRetry(async () => {
			return await db
				.select({
					id: expenses.id,
					amount: expenses.amount,
					currency: expenses.currency,
					description: expenses.description,
					category: expenses.category,
					createdAt: expenses.createdAt,
				})
				.from(expenses)
				.where(and(eq(expenses.paidBy, userId), eq(expenses.isPersonal, true), eq(expenses.deleted, false)))
				.orderBy(desc(expenses.createdAt))
				.limit(20);
		});

		if (recentTransactions.length === 0) {
			await ctx.reply(
				'📭 <b>No Transaction History</b>\n\n' + 'Start tracking personal expenses with:\n' + '<code>/add [amount] [description]</code>',
				{ parse_mode: 'HTML' },
			);
			return;
		}

		let message = '📜 <b>Personal Transaction History</b>\n\n';

		for (const tx of recentTransactions) {
			const date = new Date(tx.createdAt).toLocaleDateString();
			const category = tx.category ? `[${tx.category}]` : '';
			const amount = Money.fromDatabase(tx.amount);

			message += `💵 <b>${date}</b> - ${tx.description} ${category}\n`;
			message += `   ${formatMoney(amount)}\n\n`;
		}

		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 View Balance', callback_data: 'view_balance' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }],
				],
			},
		});
	} catch (error) {
		logger.error('Error getting personal history', error);
		await ctx.reply('❌ Error retrieving transaction history. Please try again.');
	}
}
