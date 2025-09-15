/**
 * Balance command - Shows current balances for the group
 * Uses Money class for accurate financial calculations
 */

import { Context } from 'grammy';
import { eq, and, sql, desc, isNull, inArray } from 'drizzle-orm';
import { createDb, withRetry } from '../db';
import { expenses, expenseSplits, settlements, groups, users, trips } from '../db/schema';
import { Money, sumMoney, formatMoney } from '../utils/money';
import type { Env } from '../index';

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
            const result = await db
                .select()
                .from(groups)
                .where(eq(groups.telegramId, groupId))
                .limit(1);
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
                    .where(
                        and(
                            eq(trips.groupId, groupId),
                            eq(trips.id, tripArg)
                        )
                    )
                    .limit(1);
                return result[0];
            });

            if (trip) {
                tripFilter = trip.id;
                tripName = trip.name;
            }
        }

        // Calculate balances using Drizzle queries
        const balances = await withRetry(async () => {
            // Get all expenses for the group
            const groupExpenses = await db
                .select({
                    id: expenses.id,
                    amount: expenses.amount,
                    paidBy: expenses.paidBy,
                    tripId: expenses.tripId
                })
                .from(expenses)
                .where(
                    and(
                        eq(expenses.groupId, groupId),
                        eq(expenses.deleted, false),
                        tripFilter ? eq(expenses.tripId, tripFilter) : isNull(expenses.tripId)
                    )
                );

            // Get all expense splits
            const splits = await db
                .select({
                    expenseId: expenseSplits.expenseId,
                    userId: expenseSplits.userId,
                    amount: expenseSplits.amount
                })
                .from(expenseSplits)
                .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
                .where(
                    and(
                        eq(expenses.groupId, groupId),
                        eq(expenses.deleted, false),
                        tripFilter ? eq(expenses.tripId, tripFilter) : isNull(expenses.tripId)
                    )
                );

            // Get all settlements
            const groupSettlements = await db
                .select({
                    fromUser: settlements.fromUser,
                    toUser: settlements.toUser,
                    amount: settlements.amount
                })
                .from(settlements)
                .where(
                    and(
                        eq(settlements.groupId, groupId),
                        tripFilter ? eq(settlements.tripId, tripFilter) : isNull(settlements.tripId)
                    )
                );

            // Calculate net balances
            const userBalances: Record<string, Money> = {};

            // Add amounts paid by users
            for (const expense of groupExpenses) {
                const amount = Money.fromDatabase(expense.amount);
                const currentBalance = userBalances[expense.paidBy] || new Money(0);
                userBalances[expense.paidBy] = currentBalance.add(amount);
            }

            // Subtract amounts owed by users
            for (const split of splits) {
                const amount = Money.fromDatabase(split.amount);
                const currentBalance = userBalances[split.userId] || new Money(0);
                userBalances[split.userId] = currentBalance.subtract(amount);
            }

            // Apply settlements
            for (const settlement of groupSettlements) {
                const amount = Money.fromDatabase(settlement.amount);
                const fromBalance = userBalances[settlement.fromUser] || new Money(0);
                const toBalance = userBalances[settlement.toUser] || new Money(0);
                userBalances[settlement.fromUser] = fromBalance.subtract(amount);
                userBalances[settlement.toUser] = toBalance.add(amount);
            }

            return userBalances;
        });

        // Get user details for display
        const userIds = Object.keys(balances);
        const userDetails = await withRetry(async () => {
            return await db
                .select({
                    telegramId: users.telegramId,
                    firstName: users.firstName,
                    username: users.username
                })
                .from(users)
                .where(userIds.length > 0 ? inArray(users.telegramId, userIds) : sql`1=0`);
        });

        // Create user map for easy lookup
        const userMap: Record<string, { firstName: string | null; username: string | null }> = {};
        for (const user of userDetails) {
            userMap[user.telegramId] = {
                firstName: user.firstName,
                username: user.username
            };
        }

        // Format balance message
        let message = tripName ? `💰 *Balances for ${tripName}*\n\n` : '💰 *Current Balances*\n\n';
        
        // Sort users by balance (creditors first)
        const sortedUsers = Object.entries(balances)
            .filter(([_, balance]) => !balance.abs().isLessThan(new Money(0.01)))
            .sort(([, a], [, b]) => {
                if (a.isGreaterThan(b)) return -1;
                if (a.isLessThan(b)) return 1;
                return 0;
            });

        if (sortedUsers.length === 0) {
            message += '✅ All settled up!';
        } else {
            for (const [userId, balance] of sortedUsers) {
                const user = userMap[userId];
                const name = user?.firstName || user?.username || 'Unknown';

                if (balance.isGreaterThan(new Money(0.01))) {
                    message += `👤 ${name}: *+${formatMoney(balance)}* (owed)\n`;
                } else if (balance.isLessThan(new Money(-0.01))) {
                    message += `👤 ${name}: *-${formatMoney(balance.abs())}* (owes)\n`;
                }
            }

            // Add settlement suggestions
            message += '\n💡 *Suggested settlements:*\n';
            const suggestions = calculateSettlements(balances, userMap);
            for (const suggestion of suggestions) {
                message += suggestion + '\n';
            }
        }

        await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
        await ctx.reply('Sorry, there was an error calculating balances. Please try again later.');
    }
}

function calculateSettlements(
    balances: Record<string, Money>,
    userMap: Record<string, { firstName: string | null; username: string | null }>
): string[] {
    const suggestions: string[] = [];
    const debtors: Array<[string, Money]> = [];
    const creditors: Array<[string, Money]> = [];

    // Separate debtors and creditors
    for (const [userId, balance] of Object.entries(balances)) {
        if (balance.isGreaterThan(new Money(0.01))) {
            creditors.push([userId, balance]);
        } else if (balance.isLessThan(new Money(-0.01))) {
            debtors.push([userId, balance.abs()]);
        }
    }

    // Sort for optimal settlements
    debtors.sort((a, b) => b[1].isGreaterThan(a[1]) ? 1 : -1);
    creditors.sort((a, b) => b[1].isGreaterThan(a[1]) ? 1 : -1);

    // Generate settlement suggestions
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const [debtorId, debtAmount] = debtors[i];
        const [creditorId, creditAmount] = creditors[j];

        const debtorName = userMap[debtorId]?.firstName || userMap[debtorId]?.username || 'Unknown';
        const creditorName = userMap[creditorId]?.firstName || userMap[creditorId]?.username || 'Unknown';

        const settleAmount = debtAmount.isLessThan(creditAmount) ? debtAmount : creditAmount;

        if (settleAmount.isGreaterThan(new Money(0.01))) {
            suggestions.push(`• ${debtorName} → ${creditorName}: ${formatMoney(settleAmount)}`);
        }

        debtors[i][1] = debtors[i][1].subtract(settleAmount);
        creditors[j][1] = creditors[j][1].subtract(settleAmount);

        if (debtors[i][1].isLessThan(new Money(0.01))) i++;
        if (creditors[j][1].isLessThan(new Money(0.01))) j++;
    }

    return suggestions;
}