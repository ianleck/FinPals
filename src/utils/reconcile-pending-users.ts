import { eq } from 'drizzle-orm';
import { type Database } from '../db';
import { logger } from './logger';
import { users, expenseSplits, expenses, settlements, groupMembers, budgets, expenseTemplates, recurringExpenses } from '../db/schema';

// Cache reconciled users for 5 minutes to avoid repeated checks
const reconciledCache = new Map<string, number>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Reconciles pending users with their real telegram IDs when they become active
 * This prevents duplicate participants when a pending user starts using the bot
 */
export async function reconcilePendingUser(db: Database, realUserId: string, username: string): Promise<void> {
	const pendingUserId = `pending_${username}`;
	const cacheKey = `${realUserId}:${username}`;

	// Check cache first
	const cachedTime = reconciledCache.get(cacheKey);
	if (cachedTime && Date.now() - cachedTime < CACHE_TTL) {
		return; // Already reconciled recently
	}

	try {
		// Check if there's a pending user with this username
		const pendingUser = await db.select().from(users).where(eq(users.telegramId, pendingUserId)).limit(1);

		if (pendingUser.length === 0) {
			// No pending user to reconcile, cache this
			reconciledCache.set(cacheKey, Date.now());
			return;
		}

		logger.info(`Reconciling pending user ${pendingUserId} with real user ${realUserId}`);

		// Batch all reconciliation updates using Drizzle ORM
		await Promise.all([
			// Update expense_splits
			db.update(expenseSplits).set({ userId: realUserId }).where(eq(expenseSplits.userId, pendingUserId)),

			// Update expenses - paid_by
			db.update(expenses).set({ paidBy: realUserId }).where(eq(expenses.paidBy, pendingUserId)),

			// Update expenses - created_by
			db.update(expenses).set({ createdBy: realUserId }).where(eq(expenses.createdBy, pendingUserId)),

			// Update settlements - from_user
			db.update(settlements).set({ fromUser: realUserId }).where(eq(settlements.fromUser, pendingUserId)),

			// Update settlements - to_user
			db.update(settlements).set({ toUser: realUserId }).where(eq(settlements.toUser, pendingUserId)),

			// Update group_members
			db.update(groupMembers).set({ userId: realUserId }).where(eq(groupMembers.userId, pendingUserId)),

			// Update budgets
			db.update(budgets).set({ userId: realUserId }).where(eq(budgets.userId, pendingUserId)),

			// Update expense_templates
			db.update(expenseTemplates).set({ userId: realUserId }).where(eq(expenseTemplates.userId, pendingUserId)),

			// Update recurring_expenses
			db.update(recurringExpenses).set({ createdBy: realUserId }).where(eq(recurringExpenses.createdBy, pendingUserId)),
		]);

		// Delete the pending user record
		await db.delete(users).where(eq(users.telegramId, pendingUserId));

		// Cache successful reconciliation
		reconciledCache.set(cacheKey, Date.now());

		// Clean up old cache entries periodically
		if (reconciledCache.size > 100) {
			const now = Date.now();
			for (const [key, time] of reconciledCache.entries()) {
				if (now - time > CACHE_TTL) {
					reconciledCache.delete(key);
				}
			}
		}

		logger.info(`Successfully reconciled pending user ${pendingUserId} to ${realUserId}`);
	} catch (error) {
		logger.error(`Error reconciling pending user ${pendingUserId}`, error);
		// Don't throw - we don't want to break the flow
	}
}

/**
 * Check if a user needs reconciliation based on their username
 */
export async function checkAndReconcileUser(db: Database, realUserId: string, username: string | null): Promise<void> {
	if (!username) {
		return;
	}

	await reconcilePendingUser(db, realUserId, username);
}
