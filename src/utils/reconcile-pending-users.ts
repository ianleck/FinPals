import type { D1Database } from '@cloudflare/workers-types';

// Cache reconciled users for 5 minutes to avoid repeated checks
const reconciledCache = new Map<string, number>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Reconciles pending users with their real telegram IDs when they become active
 * This prevents duplicate participants when a pending user starts using the bot
 */
export async function reconcilePendingUser(
	db: D1Database,
	realUserId: string,
	username: string
): Promise<void> {
	const pendingUserId = `pending_${username}`;
	const cacheKey = `${realUserId}:${username}`;
	
	// Check cache first
	const cachedTime = reconciledCache.get(cacheKey);
	if (cachedTime && Date.now() - cachedTime < CACHE_TTL) {
		return; // Already reconciled recently
	}
	
	try {
		// Check if there's a pending user with this username
		const pendingUser = await db
			.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?')
			.bind(pendingUserId)
			.first();
			
		if (!pendingUser) {
			// No pending user to reconcile, cache this
			reconciledCache.set(cacheKey, Date.now());
			return;
		}
		
		console.log(`Reconciling pending user ${pendingUserId} with real user ${realUserId}`);
		
		// Batch all reconciliation updates
		const updates = [
			{ table: 'expense_splits', column: 'user_id' },
			{ table: 'expenses', column: 'paid_by' },
			{ table: 'expenses', column: 'created_by' },
			{ table: 'settlements', column: 'from_user' },
			{ table: 'settlements', column: 'to_user' },
			{ table: 'group_members', column: 'user_id' },
			{ table: 'budgets', column: 'user_id' },
			{ table: 'expense_templates', column: 'user_id' },
			{ table: 'recurring_expenses', column: 'created_by' }
		];
		
		// Execute all updates
		await Promise.all(
			updates.map(({ table, column }) =>
				db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`)
					.bind(realUserId, pendingUserId)
					.run()
			)
		);
		
		// Delete the pending user record
		await db.prepare('DELETE FROM users WHERE telegram_id = ?').bind(pendingUserId).run();
		
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
			
		console.log(`Successfully reconciled pending user ${pendingUserId} to ${realUserId}`);
	} catch (error) {
		console.error(`Error reconciling pending user ${pendingUserId}:`, error);
		// Don't throw - we don't want to break the flow
	}
}

/**
 * Check if a user needs reconciliation based on their username
 */
export async function checkAndReconcileUser(
	db: D1Database,
	realUserId: string,
	username: string | null
): Promise<void> {
	if (!username) {
		return;
	}
	
	await reconcilePendingUser(db, realUserId, username);
}