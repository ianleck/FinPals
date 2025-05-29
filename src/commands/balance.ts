import { Context } from 'grammy';

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
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
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

			await ctx.reply(emptyMessage, { parse_mode: 'HTML' });
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

		await ctx.reply(message, {
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
		await ctx.reply('❌ Error calculating balances. Please try again.');
	}
}
