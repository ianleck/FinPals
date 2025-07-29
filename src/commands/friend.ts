import { Context } from 'grammy';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';

interface FriendBalance {
	group_id: string;
	group_name?: string;
	net_balance: number;
	total_expenses: number;
	expense_count: number;
	last_activity?: string;
}

export async function handleFriend(ctx: Context, db: D1Database) {
	const userId = ctx.from?.id.toString();
	if (!userId) return;

	const message = ctx.message?.text || '';
	const args = message.split(' ').slice(1);

	if (args.length === 0) {
		await reply(ctx, 
			'❌ Please specify a friend!\n\n' +
			'Usage: /friend @username\n' +
			'Example: /friend @john',
			{ parse_mode: 'HTML' }
		);
		return;
	}

	const friendMention = args[0];
	if (!friendMention.startsWith('@')) {
		await reply(ctx, '❌ Please mention the friend (@username)');
		return;
	}

	const friendUsername = friendMention.substring(1);

	try {
		// Find the friend user
		const friendUser = await db.prepare(`
			SELECT telegram_id, username, first_name
			FROM users
			WHERE username = ?
			LIMIT 1
		`).bind(friendUsername).first();

		if (!friendUser) {
			await reply(ctx, 
				`❌ User ${friendMention} not found.\n\n` +
				'They need to use FinPals at least once.',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		const friendId = friendUser.telegram_id as string;
		const friendName = friendUser.username || friendUser.first_name || 'User';

		// Get all groups where both users are members
		const sharedGroups = await db.prepare(`
			SELECT DISTINCT g.id, g.name
			FROM telegram_groups g
			JOIN group_members gm1 ON g.id = gm1.group_id
			JOIN group_members gm2 ON g.id = gm2.group_id
			WHERE gm1.user_id = ? AND gm2.user_id = ?
				AND gm1.active = TRUE AND gm2.active = TRUE
		`).bind(userId, friendId).all();

		if (!sharedGroups.results || sharedGroups.results.length === 0) {
			await reply(ctx, 
				`You don't share any groups with @${friendName} yet.\n\n` +
				'Add them to a group and start splitting expenses!',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Get balance and activity for each shared group
		const groupBalances: FriendBalance[] = [];
		let totalOwed = 0;
		let totalOwing = 0;

		for (const group of sharedGroups.results) {
			const groupId = group.id as string;
			
			// Get net balance between users in this group
			const balance = await db.prepare(`
				WITH expense_balances AS (
					SELECT 
						e.paid_by as creditor,
						es.user_id as debtor,
						SUM(es.amount) as amount
					FROM expenses e
					JOIN expense_splits es ON e.id = es.expense_id
					WHERE e.group_id = ? AND e.deleted = FALSE
						AND ((e.paid_by = ? AND es.user_id = ?) 
						  OR (e.paid_by = ? AND es.user_id = ?))
					GROUP BY e.paid_by, es.user_id
				),
				settlement_balances AS (
					SELECT 
						to_user as creditor,
						from_user as debtor,
						SUM(amount) as amount
					FROM settlements
					WHERE group_id = ?
						AND ((to_user = ? AND from_user = ?) 
						  OR (to_user = ? AND from_user = ?))
					GROUP BY to_user, from_user
				),
				all_activity AS (
					SELECT 
						e.created_at,
						e.amount as total_amount
					FROM expenses e
					WHERE e.group_id = ? AND e.deleted = FALSE
						AND (e.paid_by = ? OR e.paid_by = ?)
						AND EXISTS (
							SELECT 1 FROM expense_splits es 
							WHERE es.expense_id = e.id 
							AND (es.user_id = ? OR es.user_id = ?)
						)
				)
				SELECT 
					COALESCE(SUM(CASE 
						WHEN creditor = ? AND debtor = ? THEN amount
						WHEN creditor = ? AND debtor = ? THEN -amount
						ELSE 0
					END), 0) as net_balance,
					COUNT(DISTINCT aa.created_at) as expense_count,
					SUM(aa.total_amount) as total_expenses,
					MAX(aa.created_at) as last_activity
				FROM (
					SELECT creditor, debtor, amount FROM expense_balances
					UNION ALL
					SELECT creditor, debtor, -amount FROM settlement_balances
				) balances
				LEFT JOIN all_activity aa ON 1=1
			`).bind(
				groupId, userId, friendId, friendId, userId,
				groupId, userId, friendId, friendId, userId,
				groupId, userId, friendId, userId, friendId,
				userId, friendId, friendId, userId
			).first();

			const netBalance = balance?.net_balance as number || 0;
			
			if (Math.abs(netBalance) > 0.01 || (balance?.expense_count as number || 0) > 0) {
				groupBalances.push({
					group_id: groupId,
					group_name: group.name as string,
					net_balance: netBalance,
					total_expenses: balance?.total_expenses as number || 0,
					expense_count: balance?.expense_count as number || 0,
					last_activity: balance?.last_activity as string
				});

				if (netBalance > 0) {
					totalOwed += netBalance;
				} else {
					totalOwing += Math.abs(netBalance);
				}
			}
		}

		// Format the response
		let message = `👥 <b>Friend View: @${friendName}</b>\n\n`;

		if (groupBalances.length === 0) {
			message += 'No shared expenses yet!\n\n';
			message += `You share ${sharedGroups.results.length} group${sharedGroups.results.length > 1 ? 's' : ''} with @${friendName}.`;
		} else {
			// Overall summary
			if (totalOwed > totalOwing) {
				const netOwed = totalOwed - totalOwing;
				message += `💰 <b>@${friendName} owes you: ${formatCurrency(netOwed, 'USD')}</b>\n\n`;
			} else if (totalOwing > totalOwed) {
				const netOwing = totalOwing - totalOwed;
				message += `💸 <b>You owe @${friendName}: ${formatCurrency(netOwing, 'USD')}</b>\n\n`;
			} else {
				message += `✅ <b>All settled up with @${friendName}!</b>\n\n`;
			}

			// Per-group breakdown
			message += '<b>By Group:</b>\n';
			for (const gb of groupBalances) {
				const groupName = gb.group_name || 'Group';
				
				if (gb.net_balance > 0.01) {
					message += `📍 ${groupName}: @${friendName} owes ${formatCurrency(gb.net_balance, 'USD')}\n`;
				} else if (gb.net_balance < -0.01) {
					message += `📍 ${groupName}: You owe ${formatCurrency(Math.abs(gb.net_balance), 'USD')}\n`;
				} else if (gb.expense_count > 0) {
					message += `📍 ${groupName}: Settled (${gb.expense_count} expenses)\n`;
				}
			}

			// Stats
			const totalExpenseCount = groupBalances.reduce((sum, gb) => sum + gb.expense_count, 0);
			const totalExpenseAmount = groupBalances.reduce((sum, gb) => sum + gb.total_expenses, 0);
			
			message += `\n📊 <b>Stats:</b>\n`;
			message += `• Shared expenses: ${totalExpenseCount}\n`;
			message += `• Total amount: ${formatCurrency(totalExpenseAmount, 'USD')}\n`;
			message += `• Active in ${groupBalances.length} group${groupBalances.length > 1 ? 's' : ''}`;
		}

		// Add action buttons
		const buttons = [];
		if (Math.abs(totalOwed - totalOwing) > 0.01) {
			buttons.push([{ 
				text: '💸 Settle Up', 
				callback_data: `friend_settle_${friendId}` 
			}]);
		}
		buttons.push([{ 
			text: '📊 View Activity', 
			callback_data: `friend_activity_${friendId}` 
		}]);

		await reply(ctx, message, {
			parse_mode: 'HTML',
			reply_markup: buttons.length > 0 ? {
				inline_keyboard: buttons
			} : undefined
		});

	} catch (error) {
		console.error('Error in friend view:', error);
		await reply(ctx, '❌ Error retrieving friend information. Please try again.');
	}
}

export async function handleFriendActivity(ctx: Context, db: D1Database, friendId: string) {
	const userId = ctx.from?.id.toString();
	if (!userId) return;

	try {
		// Get friend info
		const friendUser = await db.prepare(`
			SELECT username, first_name
			FROM users
			WHERE telegram_id = ?
		`).bind(friendId).first();

		const friendName = friendUser?.username || friendUser?.first_name || 'User';

		// Get recent shared expenses
		const activities = await db.prepare(`
			SELECT 
				e.amount,
				e.description,
				e.created_at,
				e.paid_by,
				g.name as group_name,
				es1.amount as your_share,
				es2.amount as friend_share,
				u.username as payer_username,
				u.first_name as payer_first_name
			FROM expenses e
			JOIN telegram_groups g ON e.group_id = g.id
			JOIN expense_splits es1 ON e.id = es1.expense_id AND es1.user_id = ?
			JOIN expense_splits es2 ON e.id = es2.expense_id AND es2.user_id = ?
			LEFT JOIN users u ON e.paid_by = u.telegram_id
			WHERE e.deleted = FALSE
			ORDER BY e.created_at DESC
			LIMIT 10
		`).bind(userId, friendId).all();

		let message = `📊 <b>Recent Activity with @${friendName}</b>\n\n`;

		if (!activities.results || activities.results.length === 0) {
			message += 'No shared expenses yet!';
		} else {
			for (const activity of activities.results) {
				const payerName = activity.payer_username || activity.payer_first_name || 'User';
				const isPayer = activity.paid_by === userId;
				
				message += `💵 <b>${activity.description || 'Expense'}</b>\n`;
				message += `   ${formatCurrency(activity.amount as number, 'USD')} paid by @${payerName}\n`;
				message += `   Your share: ${formatCurrency(activity.your_share as number, 'USD')}`;
				if (activity.group_name) {
					message += ` (${activity.group_name})`;
				}
				message += '\n\n';
			}
		}

		await ctx.editMessageText(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '◀️ Back', callback_data: `friend_view_${friendId}` }]
				]
			}
		});
	} catch (error) {
		console.error('Error showing friend activity:', error);
		await ctx.editMessageText('❌ Error loading activity. Please try again.');
	}
}