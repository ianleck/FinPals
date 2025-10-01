/**
 * Balance command - Shows current balances for the group
 * Uses Money class for accurate financial calculations
 */

import { Context } from 'grammy';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { createDb, withRetry } from '../db';
import { groups, users, trips } from '../db/schema';
import { Money, formatMoney } from '../utils/money';
import { logger } from '../utils/logger';
import type { Env } from '../index';
import * as balanceService from '../services/balance';
import { formatCurrency } from '../utils/currency';

export async function handleBalance(ctx: Context, env: Env, tripId?: string) {
	if (!ctx.from || !ctx.chat) {
		await ctx.reply('This command can only be used in a valid chat context.');
		return;
	}

	const chatType = ctx.chat.type;
	const isGroup = chatType === 'group' || chatType === 'supergroup';

	if (!isGroup) {
		await ctx.reply('This command can only be used in group chats. Use /personal to manage personal expenses.');
		return;
	}

	const groupId = ctx.chat.id.toString();
	const db = createDb(env);

	try {
		// Check if group exists
		const group = await withRetry(async () => {
			const result = await db.select().from(groups).where(eq(groups.telegramId, groupId)).limit(1);
			return result[0];
		});

		if (!group) {
			await ctx.reply('Please use /start first to initialize the bot in this group.');
			return;
		}

		// Parse trip filter from command or use provided tripId
		const commandText = ctx.message?.text || '';
		const tripArg = tripId || commandText.split(' ')[1];
		let tripFilter: string | null = null;
		let tripName = '';

		if (tripArg) {
			// Check if trip exists
			const trip = await withRetry(async () => {
				const result = await db
					.select()
					.from(trips)
					.where(and(eq(trips.groupId, groupId), eq(trips.id, tripArg)))
					.limit(1);
				return result[0];
			});

			if (trip) {
				tripFilter = trip.id;
				tripName = trip.name;
			}
		}

		// Calculate balances using service function (with multi-currency support)
		const balanceResults = await balanceService.calculateBalances(db, groupId, tripFilter || undefined);

		// Get user details for display
		const userIds = Array.from(new Set(balanceResults.map((b) => b.userId)));
		const userDetails = await withRetry(async () => {
			return await db
				.select({
					telegramId: users.telegramId,
					firstName: users.firstName,
					username: users.username,
				})
				.from(users)
				.where(userIds.length > 0 ? inArray(users.telegramId, userIds) : sql`1=0`);
		});

		// Create user map for easy lookup
		const userMap: Record<string, { firstName: string | null; username: string | null }> = {};
		for (const user of userDetails) {
			userMap[user.telegramId] = {
				firstName: user.firstName,
				username: user.username,
			};
		}

		// Format balance message
		let message = tripName ? `💰 *Balances for ${tripName}*\n\n` : '💰 *Current Balances*\n\n';

		// Group balances by user, then by currency
		const userBalanceMap = new Map<string, balanceService.UserBalance[]>();
		for (const balance of balanceResults) {
			if (!userBalanceMap.has(balance.userId)) {
				userBalanceMap.set(balance.userId, []);
			}
			userBalanceMap.get(balance.userId)!.push(balance);
		}

		// Sort users by total balance (considering all currencies)
		const sortedUsers = Array.from(userBalanceMap.entries()).sort(([, aBalances], [, bBalances]) => {
			// Sum all balances to determine sort order
			const aTotal = aBalances.reduce((sum, b) => sum + b.balance, 0);
			const bTotal = bBalances.reduce((sum, b) => sum + b.balance, 0);
			return bTotal - aTotal; // Creditors first (positive)
		});

		if (sortedUsers.length === 0) {
			message += '✅ All settled up!';
		} else {
			for (const [userId, userBalances] of sortedUsers) {
				const user = userMap[userId];
				const name = user?.firstName || user?.username || 'Unknown';

				// Show each currency balance for this user
				for (const balance of userBalances) {
					const absBalance = Math.abs(balance.balance);
					if (absBalance >= 0.01) {
						const formattedAmount = formatCurrency(absBalance, balance.currency);
						if (balance.balance > 0.01) {
							message += `👤 ${name}: *+${formattedAmount}* (owed)\n`;
						} else if (balance.balance < -0.01) {
							message += `👤 ${name}: *-${formattedAmount}* (owes)\n`;
						}
					}
				}
			}

			// Add settlement suggestions (using existing utility)
			message += '\n💡 *Suggested settlements:*\n';
			const suggestions = await calculateSettlementSuggestions(db, groupId, tripFilter || undefined, userMap);
			for (const suggestion of suggestions) {
				message += suggestion + '\n';
			}
		}

		await ctx.reply(message, { parse_mode: 'Markdown' });
	} catch (error) {
		logger.error('Error calculating balances', error);
		await ctx.reply('Sorry, there was an error calculating balances. Please try again later.');
	}
}

/**
 * Calculate settlement suggestions using the simplified debts utility
 */
async function calculateSettlementSuggestions(
	db: any,
	groupId: string,
	tripId: string | undefined,
	userMap: Record<string, { firstName: string | null; username: string | null }>,
): Promise<string[]> {
	try {
		const debts = await balanceService.getSimplifiedDebts(db, groupId, tripId);

		if (!debts || debts.length === 0) {
			return [];
		}

		return debts.map((debt: any) => {
			const debtorName = userMap[debt.fromUser]?.firstName || userMap[debt.fromUser]?.username || 'Unknown';
			const creditorName = userMap[debt.toUser]?.firstName || userMap[debt.toUser]?.username || 'Unknown';
			const amount = formatCurrency(Math.abs(parseFloat(debt.amount)), debt.currency || 'SGD');
			return `• ${debtorName} → ${creditorName}: ${amount}`;
		});
	} catch (error) {
		logger.error('Error calculating settlement suggestions', error);
		return [];
	}
}
