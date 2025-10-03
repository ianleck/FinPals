/**
 * Settlement Service - Business logic for settlements
 * Extracted from settle.ts command handler
 */

import { eq, and, sql } from 'drizzle-orm';
import { Database, withRetry } from '../db';
import { expenses, expenseSplits, settlements } from '../db/schema';
import { Money } from '../utils/money';

export type Settlement = {
	id: string;
	groupId: string;
	fromUser: string;
	toUser: string;
	amount: string;
	currency: string;
	createdAt: Date;
	createdBy: string;
};

export type CreateSettlementData = {
	groupId: string;
	fromUser: string;
	toUser: string;
	amount: Money;
	currency: string;
	createdBy: string;
};

/**
 * Calculate net balance between two users for a specific currency
 * Positive means user2 owes user1, negative means user1 owes user2
 * EXTRACTED from calculateNetBalance (settle.ts lines 149-197)
 * UPDATED: Now filters by currency to support multi-currency settlements
 */
export async function calculateNetBalance(
	db: Database,
	groupId: string,
	userId1: string,
	userId2: string,
	currency: string,
): Promise<Money> {
	return await withRetry(async () => {
		// Get expenses where user1 paid and user2 owes (filtered by currency)
		const user1PaidExpenses = await db
			.select({
				amount: sql<string>`SUM(${expenseSplits.amount})`,
			})
			.from(expenses)
			.innerJoin(expenseSplits, eq(expenses.id, expenseSplits.expenseId))
			.where(
				and(
					eq(expenses.groupId, groupId),
					eq(expenses.deleted, false),
					eq(expenses.currency, currency),
					eq(expenses.paidBy, userId1),
					eq(expenseSplits.userId, userId2),
				),
			);

		// Get expenses where user2 paid and user1 owes (filtered by currency)
		const user2PaidExpenses = await db
			.select({
				amount: sql<string>`SUM(${expenseSplits.amount})`,
			})
			.from(expenses)
			.innerJoin(expenseSplits, eq(expenses.id, expenseSplits.expenseId))
			.where(
				and(
					eq(expenses.groupId, groupId),
					eq(expenses.deleted, false),
					eq(expenses.currency, currency),
					eq(expenses.paidBy, userId2),
					eq(expenseSplits.userId, userId1),
				),
			);

		// Get settlements from user1 to user2 (filtered by currency)
		const user1ToUser2Settlements = await db
			.select({
				amount: sql<string>`SUM(${settlements.amount})`,
			})
			.from(settlements)
			.where(
				and(
					eq(settlements.groupId, groupId),
					eq(settlements.currency, currency),
					eq(settlements.fromUser, userId1),
					eq(settlements.toUser, userId2),
				),
			);

		// Get settlements from user2 to user1 (filtered by currency)
		const user2ToUser1Settlements = await db
			.select({
				amount: sql<string>`SUM(${settlements.amount})`,
			})
			.from(settlements)
			.where(
				and(
					eq(settlements.groupId, groupId),
					eq(settlements.currency, currency),
					eq(settlements.fromUser, userId2),
					eq(settlements.toUser, userId1),
				),
			);

		const user1Paid = Money.fromDatabase(user1PaidExpenses[0]?.amount || '0');
		const user2Paid = Money.fromDatabase(user2PaidExpenses[0]?.amount || '0');
		const user1Settled = Money.fromDatabase(user1ToUser2Settlements[0]?.amount || '0');
		const user2Settled = Money.fromDatabase(user2ToUser1Settlements[0]?.amount || '0');

		// Net balance: positive means user2 owes user1, negative means user1 owes user2
		return user1Paid.subtract(user1Settled).subtract(user2Paid.subtract(user2Settled));
	});
}

/**
 * Create a settlement record
 * EXTRACTED from handleSettle (settle.ts lines 95-103) and handleSettleCallback (lines 294-303)
 * UPDATED: Now supports multi-currency settlements
 */
export async function createSettlement(db: Database, data: CreateSettlementData): Promise<Settlement> {
	return withRetry(async () => {
		const [settlement] = await db
			.insert(settlements)
			.values({
				groupId: data.groupId,
				fromUser: data.fromUser,
				toUser: data.toUser,
				amount: data.amount.toDatabase(),
				currency: data.currency,
				createdBy: data.createdBy,
			})
			.returning();

		return settlement as Settlement;
	});
}

/**
 * Get all settlements for a group
 */
export async function getSettlements(db: Database, groupId: string): Promise<Settlement[]> {
	return withRetry(async () => {
		const results = await db.select().from(settlements).where(eq(settlements.groupId, groupId));

		return results as Settlement[];
	});
}
