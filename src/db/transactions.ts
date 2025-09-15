/**
 * Transaction wrapper functions for multi-table operations
 * Ensures data consistency and proper error handling
 */

import { eq, and } from 'drizzle-orm';
import { Database, withRetry } from './index';
import { expenses, expenseSplits, settlements, users, groupMembers } from './schema';

// Type definitions
export interface ExpenseInput {
	groupId: string | null;
	tripId?: string | null;
	amount: string;
	currency?: string;
	description?: string;
	category?: string | null;
	paidBy: string;
	createdBy: string;
	isPersonal?: boolean;
	notes?: string | null;
}

export interface SplitInput {
	userId: string;
	amount: string;
}

export interface SettlementInput {
	groupId: string | null;
	tripId?: string | null;
	fromUser: string;
	toUser: string;
	amount: string;
	currency?: string;
	createdBy: string;
	isPersonal?: boolean;
}

/**
 * Creates an expense with splits in a single transaction
 * Rolls back if any part fails
 */
export async function createExpenseWithSplits(
	db: Database,
	expenseData: ExpenseInput,
	splits: SplitInput[],
): Promise<{ id: string; amount: string; description: string | null }> {
	return withRetry(async () => {
		return await db.transaction(async (tx) => {
			// Insert the expense
			const [expense] = await tx
				.insert(expenses)
				.values({
					...expenseData,
					id: crypto.randomUUID(),
				})
				.returning({
					id: expenses.id,
					amount: expenses.amount,
					description: expenses.description,
				});

			// Insert the splits if any
			if (splits.length > 0) {
				await tx.insert(expenseSplits).values(
					splits.map((split) => ({
						expenseId: expense.id,
						userId: split.userId,
						amount: split.amount,
					})),
				);
			}

			return expense;
		});
	});
}

/**
 * Records a settlement transaction
 * Ensures atomic operation
 */
export async function recordSettlement(db: Database, settlementData: SettlementInput): Promise<{ id: string; amount: string }> {
	return withRetry(async () => {
		return await db.transaction(async (tx) => {
			// Verify both users exist
			const fromUserExists = await tx
				.select({ id: users.telegramId })
				.from(users)
				.where(eq(users.telegramId, settlementData.fromUser))
				.limit(1);

			const toUserExists = await tx
				.select({ id: users.telegramId })
				.from(users)
				.where(eq(users.telegramId, settlementData.toUser))
				.limit(1);

			if (!fromUserExists[0] || !toUserExists[0]) {
				throw new Error('One or both users do not exist');
			}

			// Insert the settlement
			const [settlement] = await tx
				.insert(settlements)
				.values({
					...settlementData,
					id: crypto.randomUUID(),
				})
				.returning({
					id: settlements.id,
					amount: settlements.amount,
				});

			return settlement;
		});
	});
}

/**
 * Deletes an expense and all its splits
 * Uses soft delete pattern
 */
export async function deleteExpenseWithSplits(db: Database, expenseId: string, userId: string): Promise<boolean> {
	return withRetry(async () => {
		return await db.transaction(async (tx) => {
			// Check if expense exists and user has permission
			const [expense] = await tx
				.select({
					id: expenses.id,
					createdBy: expenses.createdBy,
				})
				.from(expenses)
				.where(and(eq(expenses.id, expenseId), eq(expenses.deleted, false)))
				.limit(1);

			if (!expense) {
				throw new Error('Expense not found');
			}

			if (expense.createdBy !== userId) {
				throw new Error('Permission denied');
			}

			// Soft delete the expense
			await tx.update(expenses).set({ deleted: true }).where(eq(expenses.id, expenseId));

			// Note: Splits remain for audit trail but expense is marked deleted

			return true;
		});
	});
}

/**
 * Updates an expense amount and recalculates splits
 */
export async function updateExpenseWithSplits(db: Database, expenseId: string, newAmount: string, userId: string): Promise<boolean> {
	return withRetry(async () => {
		return await db.transaction(async (tx) => {
			// Check permission
			const [expense] = await tx
				.select({
					id: expenses.id,
					createdBy: expenses.createdBy,
				})
				.from(expenses)
				.where(and(eq(expenses.id, expenseId), eq(expenses.deleted, false)))
				.limit(1);

			if (!expense || expense.createdBy !== userId) {
				throw new Error('Permission denied');
			}

			// Get existing splits
			const existingSplits = await tx
				.select({
					userId: expenseSplits.userId,
				})
				.from(expenseSplits)
				.where(eq(expenseSplits.expenseId, expenseId));

			// Update expense amount
			await tx.update(expenses).set({ amount: newAmount }).where(eq(expenses.id, expenseId));

			// Delete old splits
			await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));

			// Recalculate and insert new splits
			if (existingSplits.length > 0) {
				const splitAmount = (parseFloat(newAmount) / existingSplits.length).toFixed(2);
				await tx.insert(expenseSplits).values(
					existingSplits.map((split) => ({
						expenseId: expenseId,
						userId: split.userId,
						amount: splitAmount,
					})),
				);
			}

			return true;
		});
	});
}

/**
 * Adds a user to a group with proper checks
 */
export async function addUserToGroup(
	db: Database,
	userId: string,
	groupId: string,
	userData?: { username?: string; firstName?: string; lastName?: string },
): Promise<boolean> {
	return withRetry(async () => {
		return await db.transaction(async (tx) => {
			// Ensure user exists or create
			const [existingUser] = await tx.select({ id: users.telegramId }).from(users).where(eq(users.telegramId, userId)).limit(1);

			if (!existingUser) {
				await tx.insert(users).values({
					telegramId: userId,
					username: userData?.username,
					firstName: userData?.firstName,
					lastName: userData?.lastName,
				});
			}

			// Check if already a member
			const [membership] = await tx
				.select({ userId: groupMembers.userId, active: groupMembers.active })
				.from(groupMembers)
				.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
				.limit(1);

			if (!membership) {
				// Add to group
				await tx.insert(groupMembers).values({
					groupId: groupId,
					userId: userId,
				});
			} else if (membership && !membership.active) {
				// Reactivate membership
				await tx
					.update(groupMembers)
					.set({ active: true })
					.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
			}

			return true;
		});
	});
}
