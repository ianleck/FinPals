import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';

export async function handleSettle(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await ctx.reply('⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const message = ctx.message?.text || '';
	const args = message.split(' ').slice(1); // Remove the /settle command

	if (args.length < 2) {
		await ctx.reply(
			'❌ Invalid format!\n\n' +
			'Usage: /settle @username [amount]\n' +
			'Example: /settle @john 25.50\n\n' +
			'This records that you paid the mentioned user.',
			{ parse_mode: 'HTML' }
		);
		return;
	}

	// Parse mention and amount
	const mention = args[0];
	if (!mention.startsWith('@')) {
		await ctx.reply('❌ Please mention the user you\'re settling with (@username)');
		return;
	}

	const amount = parseFloat(args[1]);
	if (isNaN(amount) || amount <= 0) {
		await ctx.reply(ERROR_MESSAGES.INVALID_AMOUNT);
		return;
	}

	const groupId = ctx.chat?.id.toString() || '';
	const fromUserId = ctx.from!.id.toString();
	const fromUsername = ctx.from!.username || ctx.from!.first_name || 'Unknown';

	try {
		// TODO: In a real implementation, we'd resolve the @mention to get the user ID
		// For now, we'll show a message that we need the user to have interacted with the bot
		
		// Check if we have any balance with mentioned users in the group
		const groupMembers = await db.prepare(`
			SELECT u.telegram_id, u.username, u.first_name
			FROM users u
			JOIN group_members gm ON u.telegram_id = gm.user_id
			WHERE gm.group_id = ? AND gm.active = TRUE AND u.username = ?
		`).bind(groupId, mention.substring(1)).first();

		if (!groupMembers) {
			await ctx.reply(
				`❌ User ${mention} not found in this group.\n\n` +
				'Make sure they have used the bot at least once.',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		const toUserId = groupMembers.telegram_id as string;
		const toUsername = groupMembers.username || groupMembers.first_name || 'User';

		// Check current balance between users
		const currentBalance = await db.prepare(`
			WITH expense_balances AS (
				SELECT 
					e.paid_by as creditor,
					es.user_id as debtor,
					SUM(es.amount) as amount
				FROM expenses e
				JOIN expense_splits es ON e.id = es.expense_id
				WHERE e.group_id = ? AND e.deleted = FALSE
					AND ((e.paid_by = ? AND es.user_id = ?) OR (e.paid_by = ? AND es.user_id = ?))
				GROUP BY e.paid_by, es.user_id
			),
			settlement_balances AS (
				SELECT 
					to_user as creditor,
					from_user as debtor,
					SUM(amount) as amount
				FROM settlements
				WHERE group_id = ?
					AND ((to_user = ? AND from_user = ?) OR (to_user = ? AND from_user = ?))
				GROUP BY to_user, from_user
			)
			SELECT 
				SUM(CASE 
					WHEN creditor = ? AND debtor = ? THEN amount
					WHEN creditor = ? AND debtor = ? THEN -amount
					ELSE 0
				END) as net_balance
			FROM (
				SELECT creditor, debtor, amount FROM expense_balances
				UNION ALL
				SELECT creditor, debtor, -amount FROM settlement_balances
			)
		`).bind(
			groupId, fromUserId, toUserId, toUserId, fromUserId,
			groupId, fromUserId, toUserId, toUserId, fromUserId,
			fromUserId, toUserId, toUserId, fromUserId
		).first();

		const netBalance = currentBalance?.net_balance as number || 0;

		// Create settlement
		const settlementId = crypto.randomUUID();
		await db.prepare(
			'INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_by) VALUES (?, ?, ?, ?, ?, ?)'
		).bind(settlementId, groupId, fromUserId, toUserId, amount, fromUserId).run();

		// Calculate new balance
		const newBalance = netBalance - amount;

		let balanceMessage = '';
		if (Math.abs(newBalance) < 0.01) {
			balanceMessage = `✅ All settled up between @${fromUsername} and @${toUsername}!`;
		} else if (newBalance > 0) {
			balanceMessage = `Remaining: @${toUsername} owes @${fromUsername} $${Math.abs(newBalance).toFixed(2)}`;
		} else {
			balanceMessage = `Remaining: @${fromUsername} owes @${toUsername} $${Math.abs(newBalance).toFixed(2)}`;
		}

		await ctx.reply(
			`💰 <b>Settlement Recorded</b>\n\n` +
			`@${fromUsername} paid @${toUsername}: <b>$${amount.toFixed(2)}</b>\n\n` +
			balanceMessage,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{ text: '📊 View All Balances', callback_data: 'view_balance' }],
						[{ text: '➕ Add Expense', callback_data: 'add_expense_help' }]
					]
				}
			}
		);

		// Send DM notification to the recipient
		try {
			await ctx.api.sendMessage(
				toUserId,
				`💰 <b>Payment Received!</b>\n\n` +
				`@${fromUsername} paid you <b>$${amount.toFixed(2)}</b>\n` +
				`Group: ${ctx.chat?.title || 'your group'}\n\n` +
				balanceMessage,
				{ parse_mode: 'HTML' }
			);
		} catch (error) {
			// User might have blocked the bot
			console.log(`Could not notify user ${toUserId}:`, error);
		}
	} catch (error) {
		console.error('Error recording settlement:', error);
		await ctx.reply(ERROR_MESSAGES.DATABASE_ERROR);
	}
}