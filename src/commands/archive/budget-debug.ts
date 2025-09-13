import { Context } from 'grammy';

export async function handleBudgetDebug(ctx: Context, db: D1Database) {
	const userId = ctx.from?.id.toString();
	if (!userId) return;

	// Check what expenses exist
	const expenses = await db.prepare(`
		SELECT id, category, amount, is_personal, created_at 
		FROM expenses 
		WHERE paid_by = ? 
			AND deleted = FALSE 
			AND created_at >= datetime('now', '-1 month')
		ORDER BY created_at DESC
	`).bind(userId).all();

	// Check what budgets exist
	const budgets = await db.prepare(`
		SELECT * FROM budgets WHERE user_id = ?
	`).bind(userId).all();

	let message = '🔍 <b>Debug Info</b>\n\n';
	
	message += '<b>Your Budgets:</b>\n';
	if (budgets.results) {
		for (const b of budgets.results) {
			message += `- "${b.category}" $${b.amount} ${b.period}\n`;
		}
	}
	
	message += '\n<b>Recent Expenses:</b>\n';
	if (expenses.results) {
		for (const e of expenses.results) {
			message += `- "${e.category}" $${e.amount} (personal: ${e.is_personal})\n`;
		}
	}

	// Test the actual query
	const testQuery = await db.prepare(`
		SELECT 
			b.category,
			(SELECT COUNT(*) FROM expenses e 
			 WHERE e.paid_by = ? 
			   AND e.category = b.category 
			   AND e.is_personal = TRUE) as matching_expenses
		FROM budgets b
		WHERE b.user_id = ?
	`).bind(userId, userId).all();

	message += '\n<b>Category Matches:</b>\n';
	if (testQuery.results) {
		for (const t of testQuery.results) {
			message += `- Budget "${t.category}" has ${t.matching_expenses} expenses\n`;
		}
	}

	await ctx.reply(message, { parse_mode: 'HTML' });
}