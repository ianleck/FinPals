import { D1Database } from '@cloudflare/workers-types';

export interface BudgetWithSpending {
	id: number;
	user_id: string;
	category: string;
	amount: number;
	period: 'daily' | 'weekly' | 'monthly';
	created_at: string;
	spent: number;
	percentage: number;
}

/**
 * Get all budgets with spending calculations for a user
 * Optimized to use a single query with window functions
 */
export async function getBudgetsWithSpending(
	db: D1Database,
	userId: string
): Promise<BudgetWithSpending[]> {
	const results = await db.prepare(`
		WITH budget_periods AS (
			SELECT 
				id,
				user_id,
				category,
				amount,
				period,
				created_at,
				CASE 
					WHEN period = 'daily' THEN datetime('now', '-1 day')
					WHEN period = 'weekly' THEN datetime('now', '-7 days')
					WHEN period = 'monthly' THEN datetime('now', '-1 month')
				END as period_start
			FROM budgets
			WHERE user_id = ?
		),
		spending_data AS (
			SELECT 
				bp.*,
				COALESCE(SUM(CASE 
					WHEN e.is_personal = TRUE THEN e.amount
					ELSE es.amount
				END), 0) as spent
			FROM budget_periods bp
			LEFT JOIN expenses e ON 
				LOWER(TRIM(e.category)) = LOWER(TRIM(bp.category))
				AND e.deleted = FALSE
				AND e.created_at >= bp.period_start
				AND (
					(e.is_personal = TRUE AND e.paid_by = bp.user_id)
					OR e.is_personal = FALSE
				)
			LEFT JOIN expense_splits es ON 
				es.expense_id = e.id 
				AND es.user_id = bp.user_id
				AND e.is_personal = FALSE
			GROUP BY bp.id
		)
		SELECT 
			*,
			ROUND((spent / amount) * 100, 0) as percentage
		FROM spending_data
		ORDER BY category
	`).bind(userId).all();

	return results.results as BudgetWithSpending[];
}

/**
 * Check if an expense would exceed budget limits
 */
export async function checkBudgetLimits(
	db: D1Database,
	userId: string,
	category: string | null,
	amount: number
): Promise<{ warning: boolean; message: string | null }> {
	if (!category) return { warning: false, message: null };

	const budget = await db.prepare(`
		SELECT 
			b.*,
			COALESCE((
				SELECT SUM(CASE 
					WHEN e.is_personal = TRUE THEN e.amount
					ELSE es.amount
				END)
				FROM expenses e
				LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = b.user_id
				WHERE LOWER(TRIM(e.category)) = LOWER(TRIM(b.category))
					AND e.deleted = FALSE
					AND e.created_at >= CASE 
						WHEN b.period = 'daily' THEN datetime('now', '-1 day')
						WHEN b.period = 'weekly' THEN datetime('now', '-7 days')
						WHEN b.period = 'monthly' THEN datetime('now', '-1 month')
					END
					AND (
						(e.is_personal = TRUE AND e.paid_by = b.user_id)
						OR (e.is_personal = FALSE AND es.user_id = b.user_id)
					)
			), 0) as current_spent
		FROM budgets b
		WHERE b.user_id = ? 
			AND LOWER(TRIM(b.category)) = LOWER(TRIM(?))
	`).bind(userId, category).first();

	if (!budget) return { warning: false, message: null };

	const newTotal = (budget.current_spent as number) + amount;
	const budgetAmount = budget.amount as number;
	const percentage = (newTotal / budgetAmount) * 100;

	if (percentage > 100) {
		return {
			warning: true,
			message: `⚠️ This will exceed your ${budget.period} budget for ${category}! ($${newTotal.toFixed(2)}/$${budgetAmount.toFixed(2)})`
		};
	} else if (percentage > 80) {
		return {
			warning: true,
			message: `⚠️ This will use ${percentage.toFixed(0)}% of your ${budget.period} budget for ${category}`
		};
	}

	return { warning: false, message: null };
}