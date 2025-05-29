import { D1Database } from '@cloudflare/workers-types';

// Common interfaces
export interface UserRow {
	telegram_id: string;
	username?: string;
	first_name?: string;
}

export interface ExpenseRow {
	id: string;
	group_id: string;
	trip_id?: string;
	amount: number;
	currency: string;
	description: string;
	category?: string;
	paid_by: string;
	created_by: string;
	created_at: string;
	deleted: boolean;
	username?: string;
	first_name?: string;
}

export interface BalanceRow {
	user1: string;
	user2: string;
	net_amount: number;
	user1_username?: string;
	user1_first_name?: string;
	user2_username?: string;
	user2_first_name?: string;
}

// Common queries
export const QUERIES = {
	GET_GROUP_EXPENSES: `
		SELECT 
			e.*,
			u.username,
			u.first_name
		FROM expenses e
		JOIN users u ON e.paid_by = u.telegram_id
		WHERE e.group_id = ? AND e.deleted = FALSE
		ORDER BY e.created_at DESC
	`,

	GET_ACTIVE_TRIP: `
		SELECT id, name FROM trips 
		WHERE group_id = ? AND status = 'active'
		LIMIT 1
	`,
};

// Data access functions
export async function getGroupExpenses(db: D1Database, groupId: string): Promise<ExpenseRow[]> {
	const result = await db.prepare(QUERIES.GET_GROUP_EXPENSES).bind(groupId).all();
	return result.results as unknown as ExpenseRow[];
}

export async function getActiveTrip(db: D1Database, groupId: string) {
	return await db.prepare(QUERIES.GET_ACTIVE_TRIP).bind(groupId).first();
}

// Transaction helper
export async function runTransaction<T>(db: D1Database, callback: () => Promise<T>): Promise<T> {
	// Note: D1 doesn't support explicit transactions yet
	// This is a placeholder for when it does
	try {
		return await callback();
	} catch (error) {
		console.error('Transaction failed:', error);
		throw error;
	}
}
