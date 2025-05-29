import { Context } from 'grammy';
import { reply } from '../utils/reply';

interface BalanceResult {
	user1: string;
	user2: string;
	net_amount: number;
	user1_username?: string;
	user1_first_name?: string;
	user2_username?: string;
	user2_first_name?: string;
}

export async function handleBalance(ctx: Context, db: D1Database, tripId?: string) {
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();
	
	if (isPersonal) {
		// Show personal expense balance
		await handlePersonalBalance(ctx, db, userId!);
		return;
	}

	const groupId = ctx.chat?.id.toString() || '';

	// Check if filtering by trip or if there's an active trip
	let filterTripId = tripId;
	let tripInfo = null;

	if (!filterTripId) {
		// Check for active trip
		const activeTrip = await db
			.prepare(
				`
			SELECT id, name FROM trips 
			WHERE group_id = ? AND status = 'active'
			LIMIT 1
		`
			)
			.bind(groupId)
			.first();

		if (activeTrip) {
			filterTripId = activeTrip.id as string;
			tripInfo = activeTrip;
		}
	} else {
		// Get trip info
		tripInfo = await db
			.prepare(
				`
			SELECT id, name FROM trips 
			WHERE id = ?
			LIMIT 1
		`
			)
			.bind(filterTripId)
			.first();
	}

	try {
		// Build query based on whether we're filtering by trip
		let query: string;
		let params: any[];

		if (filterTripId) {
			// Query with trip filter
			query = `
				WITH expense_balances AS (
					SELECT 
						e.paid_by as creditor,
						es.user_id as debtor,
						SUM(es.amount) as amount
					FROM expenses e
					JOIN expense_splits es ON e.id = es.expense_id
					WHERE e.group_id = ? AND e.trip_id = ? AND e.deleted = FALSE
					GROUP BY e.paid_by, es.user_id
				),
				settlement_balances AS (
					SELECT 
						to_user as creditor,
						from_user as debtor,
						SUM(amount) as amount
					FROM settlements
					WHERE group_id = ? AND trip_id = ?
					GROUP BY to_user, from_user
				),
			all_balances AS (
				SELECT creditor, debtor, amount FROM expense_balances
				UNION ALL
				SELECT creditor, debtor, -amount FROM settlement_balances
			),
			net_balances AS (
				SELECT 
					CASE WHEN creditor < debtor THEN creditor ELSE debtor END as user1,
					CASE WHEN creditor < debtor THEN debtor ELSE creditor END as user2,
					SUM(CASE WHEN creditor < debtor THEN amount ELSE -amount END) as net_amount
				FROM all_balances
				WHERE creditor != debtor
				GROUP BY user1, user2
				HAVING ABS(net_amount) > 0.01
			)
			SELECT 
				nb.*,
				u1.username as user1_username,
				u1.first_name as user1_first_name,
				u2.username as user2_username,
				u2.first_name as user2_first_name
			FROM net_balances nb
			LEFT JOIN users u1 ON nb.user1 = u1.telegram_id
			LEFT JOIN users u2 ON nb.user2 = u2.telegram_id
			ORDER BY ABS(net_amount) DESC
		`;
			params = [groupId, filterTripId, groupId, filterTripId];
		} else {
			// Query without trip filter (all expenses)
			query = `
				WITH expense_balances AS (
					SELECT 
						e.paid_by as creditor,
						es.user_id as debtor,
						SUM(es.amount) as amount
					FROM expenses e
					JOIN expense_splits es ON e.id = es.expense_id
					WHERE e.group_id = ? AND e.deleted = FALSE
					GROUP BY e.paid_by, es.user_id
				),
				settlement_balances AS (
					SELECT 
						to_user as creditor,
						from_user as debtor,
						SUM(amount) as amount
					FROM settlements
					WHERE group_id = ?
					GROUP BY to_user, from_user
				),
				all_balances AS (
					SELECT creditor, debtor, amount FROM expense_balances
					UNION ALL
					SELECT creditor, debtor, -amount FROM settlement_balances
				),
				net_balances AS (
					SELECT 
						CASE WHEN creditor < debtor THEN creditor ELSE debtor END as user1,
						CASE WHEN creditor < debtor THEN debtor ELSE creditor END as user2,
						SUM(CASE WHEN creditor < debtor THEN amount ELSE -amount END) as net_amount
					FROM all_balances
					WHERE creditor != debtor
					GROUP BY user1, user2
					HAVING ABS(net_amount) > 0.01
				)
				SELECT 
					nb.*,
					u1.username as user1_username,
					u1.first_name as user1_first_name,
					u2.username as user2_username,
					u2.first_name as user2_first_name
				FROM net_balances nb
				LEFT JOIN users u1 ON nb.user1 = u1.telegram_id
				LEFT JOIN users u2 ON nb.user2 = u2.telegram_id
				ORDER BY ABS(net_amount) DESC
			`;
			params = [groupId, groupId];
		}

		const balances = await db
			.prepare(query)
			.bind(...params)
			.all<BalanceResult>();

		if (!balances.results || balances.results.length === 0) {
			let emptyMessage = '✨ <b>All Settled Up!</b>\n\n';
			if (tripInfo) {
				emptyMessage += `No outstanding balances for trip "${tripInfo.name}".\n\n`;
			} else {
				emptyMessage += 'No outstanding balances in this group.\n\n';
			}
			emptyMessage += 'Start tracking expenses with /add';

			await reply(ctx, emptyMessage, { parse_mode: 'HTML' });
			return;
		}

		// Format balances for display
		let message = '💰 <b>Current Balances</b>';
		if (tripInfo) {
			message += ` - ${tripInfo.name}`;
		}
		message += '\n\n';
		let totalUnsettled = 0;

		for (const balance of balances.results) {
			const user1Name = balance.user1_username || balance.user1_first_name || 'User';
			const user2Name = balance.user2_username || balance.user2_first_name || 'User';
			const amount = Math.abs(balance.net_amount);
			totalUnsettled += amount;

			if (balance.net_amount > 0) {
				message += `@${user2Name} owes @${user1Name}: <b>$${amount.toFixed(2)}</b>\n`;
			} else {
				message += `@${user1Name} owes @${user2Name}: <b>$${amount.toFixed(2)}</b>\n`;
			}
		}

		message += `\n💵 Total unsettled: <b>$${(totalUnsettled / 2).toFixed(2)}</b>`;

		await reply(ctx, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '💸 Settle Up', callback_data: 'settle_help' }],
					[{ text: '📊 View History', callback_data: 'view_history' }],
				],
			},
		});
	} catch (error) {
		console.error('Error calculating balances:', error);
		await reply(ctx, '❌ Error calculating balances. Please try again.');
	}
}

// New function for personal expense balance
async function handlePersonalBalance(ctx: Context, db: D1Database, userId: string) {
	try {
		// Get total personal expenses (money out)
		const expenses = await db.prepare(`
			SELECT 
				SUM(amount) as total_spent,
				COUNT(*) as expense_count,
				MAX(created_at) as last_expense
			FROM expenses
			WHERE paid_by = ? AND is_personal = TRUE AND deleted = FALSE
		`).bind(userId).first();

		// Get personal expenses by category
		const byCategory = await db.prepare(`
			SELECT 
				COALESCE(category, 'Uncategorized') as category,
				SUM(amount) as total,
				COUNT(*) as count
			FROM expenses
			WHERE paid_by = ? AND is_personal = TRUE AND deleted = FALSE
			GROUP BY category
			ORDER BY total DESC
		`).bind(userId).all();

		// Get monthly totals for the last 3 months
		const monthlyTotals = await db.prepare(`
			SELECT 
				strftime('%Y-%m', created_at) as month,
				SUM(amount) as total
			FROM expenses
			WHERE paid_by = ? AND is_personal = TRUE AND deleted = FALSE
				AND created_at >= datetime('now', '-3 months')
			GROUP BY month
			ORDER BY month DESC
		`).bind(userId).all();

		let message = '💰 <b>Personal Expense Balance</b>\n\n';

		if (!expenses || expenses.expense_count === 0) {
			message += '🆕 No personal expenses tracked yet!\n\n';
			message += 'Start tracking with:\n';
			message += '<code>/add [amount] [description]</code>';
		} else {
			const totalSpent = expenses.total_spent as number || 0;
			const expenseCount = expenses.expense_count as number || 0;
			const avgExpense = totalSpent / expenseCount;

			message += `💸 <b>Total Spent:</b> $${totalSpent.toFixed(2)}\n`;
			message += `📋 <b>Total Expenses:</b> ${expenseCount}\n`;
			message += `📊 <b>Average Expense:</b> $${avgExpense.toFixed(2)}\n\n`;

			if (monthlyTotals.results.length > 0) {
				message += '📅 <b>Monthly Breakdown:</b>\n';
				for (const month of monthlyTotals.results) {
					const monthDate = new Date(month.month + '-01');
					const monthName = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
					message += `  • ${monthName}: $${(month.total as number).toFixed(2)}\n`;
				}
				message += '\n';
			}

			if (byCategory.results.length > 0) {
				message += '📂 <b>By Category:</b>\n';
				for (const cat of byCategory.results) {
					const percentage = ((cat.total as number / totalSpent) * 100).toFixed(1);
					message += `  • ${cat.category}: $${(cat.total as number).toFixed(2)} (${percentage}%)\n`;
				}
			}
		}

		await reply(ctx, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 View Expenses', callback_data: 'view_personal_expenses' }],
					[{ text: '📊 Monthly Summary', callback_data: 'personal_monthly' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }],
				],
			},
		});
	} catch (error) {
		console.error('Error calculating personal balance:', error);
		await reply(ctx, '❌ Error calculating personal balance. Please try again.');
	}
}
