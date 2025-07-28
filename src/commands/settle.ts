import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';
import { reply } from '../utils/reply';

export async function handleSettle(ctx: Context, db: D1Database) {
	// Only work in group chats
	if (ctx.chat?.type === 'private') {
		await reply(ctx, '⚠️ This command only works in group chats. Add me to a group first!');
		return;
	}

	const message = ctx.message?.text || '';
	const args = message.split(' ').slice(1); // Remove the /settle command

	// If no arguments, show all unsettled balances
	if (args.length === 0) {
		await showUnsettledBalances(ctx, db);
		return;
	}

	if (args.length < 2) {
		await reply(ctx, 
			'❌ Invalid format!\n\n' +
			'Usage:\n' +
			'• /settle - Show all unsettled balances\n' +
			'• /settle @username [amount] - Record a payment\n' +
			'• /settle @username partial - Pay part of what you owe\n\n' +
			'Examples:\n' +
			'• /settle @john 25.50 - Pay John $25.50\n' +
			'• /settle @john partial - Choose amount to pay John',
			{ parse_mode: 'HTML' }
		);
		return;
	}

	// Parse mention and amount
	const mention = args[0];
	if (!mention.startsWith('@')) {
		await reply(ctx, '❌ Please mention the user you\'re settling with (@username)');
		return;
	}

	const groupId = ctx.chat?.id.toString() || '';
	const fromUserId = ctx.from!.id.toString();
	const fromUsername = ctx.from!.username || ctx.from!.first_name || 'Unknown';

	// Check for partial settlement
	if (args[1].toLowerCase() === 'partial') {
		await handlePartialSettlement(ctx, db, mention, groupId, fromUserId, fromUsername);
		return;
	}

	const amount = parseFloat(args[1]);
	if (isNaN(amount) || amount <= 0) {
		await reply(ctx, ERROR_MESSAGES.INVALID_AMOUNT);
		return;
	}

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
			await reply(ctx, 
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

		await reply(ctx, 
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
		}
	} catch (error) {
		// Error recording settlement
		await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
	}
}

export async function showUnsettledBalances(ctx: Context, db: D1Database) {
	const groupId = ctx.chat!.id.toString();

	try {
		// Get all unsettled balances in the group
		const balances = await db.prepare(`
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
		`).bind(groupId, groupId).all();

		if (!balances.results || balances.results.length === 0) {
			await reply(ctx, '✅ All settled up! No outstanding balances.');
			return;
		}

		let message = '💳 <b>Unsettled Balances</b>\n\n';
		const inlineButtons = [];

		for (const balance of balances.results) {
			const user1Name = (balance.user1_username as string) || (balance.user1_first_name as string) || 'User';
			const user2Name = (balance.user2_username as string) || (balance.user2_first_name as string) || 'User';
			const amount = Math.abs(balance.net_amount as number);

			let owerId: string;
			let owerName: string;
			let owedId: string;
			let owedName: string;

			if ((balance.net_amount as number) > 0) {
				// user2 owes user1
				owerId = balance.user2 as string;
				owerName = user2Name;
				owedId = balance.user1 as string;
				owedName = user1Name;
			} else {
				// user1 owes user2
				owerId = balance.user1 as string;
				owerName = user1Name;
				owedId = balance.user2 as string;
				owedName = user2Name;
			}

			message += `@${owerName} owes @${owedName}: <b>$${amount.toFixed(2)}</b>\n`;

			// Create settle buttons with format: settle_{owerId}_{owedId}_{amount}
			const fullButtonText = `💰 Settle $${amount.toFixed(2)}`;
			const fullCallbackData = `settle_${owerId}_${owedId}_${amount.toFixed(2)}_full`;
			
			const partialButtonText = `💵 Partial Payment`;
			const partialCallbackData = `settle_${owerId}_${owedId}_${amount.toFixed(2)}_partial`;
			
			// Add buttons for this balance
			inlineButtons.push([
				{ text: fullButtonText, callback_data: fullCallbackData },
				{ text: partialButtonText, callback_data: partialCallbackData }
			]);
		}

		message += '\nClick a button below to settle a specific balance:';

		await reply(ctx, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: inlineButtons
			}
		});

	} catch (error) {
		console.error('Error showing unsettled balances:', error);
		await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
	}
}

export async function handleSettleCallback(ctx: Context, db: D1Database) {
	if (!ctx.callbackQuery?.data) return;
	const parts = ctx.callbackQuery.data.split('_');
	const owerId = parts[1];
	const owedId = parts[2];
	const amount = parseFloat(parts[3]);
	const settlementType = parts[4]; // 'full' or 'partial'
	
	const currentUserId = ctx.from!.id.toString();
	
	// Allow both parties to confirm the settlement
	if (currentUserId !== owerId && currentUserId !== owedId) {
		await ctx.answerCallbackQuery('Only the involved parties can settle this balance');
		return;
	}
	
	await ctx.answerCallbackQuery();
	
	// Handle partial settlement
	if (settlementType === 'partial') {
		await handlePartialSettlementCallback(ctx, db, owerId, owedId, amount);
		return;
	}
	
	// Create a simulated settle command
	const groupId = ctx.chat?.id.toString();
	if (!groupId) return;
	
	// Get usernames for the settlement
	const users = await db.prepare(`
		SELECT telegram_id, username, first_name
		FROM users
		WHERE telegram_id IN (?, ?)
	`).bind(owerId, owedId).all();
	
	const owerUser = users.results.find(u => u.telegram_id === owerId);
	const owedUser = users.results.find(u => u.telegram_id === owedId);
	
	const owerName = owerUser?.username || owerUser?.first_name || 'User';
	const owedName = owedUser?.username || owedUser?.first_name || 'User';
	
	// Record the settlement
	const settlementId = crypto.randomUUID();
	await db.prepare(
		'INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_by) VALUES (?, ?, ?, ?, ?, ?)'
	).bind(settlementId, groupId, owerId, owedId, amount, currentUserId).run();
	
	// Update the message based on who is settling
	let settlementMessage: string;
	if (currentUserId === owerId) {
		// The person who owes is settling
		settlementMessage = `💰 <b>Settlement Recorded</b>\n\n` +
			`@${owerName} paid @${owedName}: <b>$${amount.toFixed(2)}</b>\n\n` +
			`✅ This balance has been settled!`;
	} else {
		// The person who is owed is recording the settlement
		settlementMessage = `💰 <b>Settlement Recorded</b>\n\n` +
			`@${owedName} recorded that @${owerName} paid: <b>$${amount.toFixed(2)}</b>\n\n` +
			`✅ This balance has been settled!`;
	}
	
	await ctx.editMessageText(settlementMessage, { parse_mode: 'HTML' });
	
	// Send notification to the other party
	try {
		if (currentUserId === owerId) {
			// Notify the person who received the payment
			await ctx.api.sendMessage(
				owedId,
				`💰 <b>Payment Received!</b>\n\n` +
				`@${owerName} paid you <b>$${amount.toFixed(2)}</b>\n` +
				`Group: ${ctx.chat?.title || 'your group'}`,
				{ parse_mode: 'HTML' }
			);
		} else {
			// Notify the person who owes that their payment was recorded
			await ctx.api.sendMessage(
				owerId,
				`💰 <b>Payment Recorded!</b>\n\n` +
				`@${owedName} has recorded that you paid them <b>$${amount.toFixed(2)}</b>\n` +
				`Group: ${ctx.chat?.title || 'your group'}`,
				{ parse_mode: 'HTML' }
			);
		}
	} catch (error) {
		// User might have blocked the bot
	}
}

async function handlePartialSettlement(
	ctx: Context, 
	db: D1Database, 
	mention: string, 
	groupId: string, 
	fromUserId: string, 
	fromUsername: string
) {
	try {
		// Get the mentioned user
		const groupMembers = await db.prepare(`
			SELECT u.telegram_id, u.username, u.first_name
			FROM users u
			JOIN group_members gm ON u.telegram_id = gm.user_id
			WHERE gm.group_id = ? AND gm.active = TRUE AND u.username = ?
		`).bind(groupId, mention.substring(1)).first();

		if (!groupMembers) {
			await reply(ctx, 
				`❌ User ${mention} not found in this group.\n\n` +
				'Make sure they have used the bot at least once.',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		const toUserId = groupMembers.telegram_id as string;
		const toUsername = groupMembers.username || groupMembers.first_name || 'User';

		// Get current balance
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

		if (Math.abs(netBalance) < 0.01) {
			await reply(ctx, `✅ You're already settled up with @${toUsername}!`);
			return;
		}

		const owedAmount = Math.abs(netBalance);
		const isFromUserOwing = netBalance < 0;

		if (!isFromUserOwing) {
			await reply(ctx, `❌ @${toUsername} owes you $${owedAmount.toFixed(2)}. They should initiate the payment.`);
			return;
		}

		// Show partial payment options
		const buttons = [];
		const commonAmounts = [10, 20, 25, 50, 100];
		
		// Add quick amount buttons
		for (const amt of commonAmounts) {
			if (amt < owedAmount) {
				buttons.push([{ 
					text: `💵 Pay $${amt}`, 
					callback_data: `partial_pay_${toUserId}_${amt}` 
				}]);
			}
		}
		
		// Add percentage buttons
		buttons.push([
			{ text: '25%', callback_data: `partial_pay_${toUserId}_${(owedAmount * 0.25).toFixed(2)}` },
			{ text: '50%', callback_data: `partial_pay_${toUserId}_${(owedAmount * 0.50).toFixed(2)}` },
			{ text: '75%', callback_data: `partial_pay_${toUserId}_${(owedAmount * 0.75).toFixed(2)}` }
		]);
		
		// Add custom amount option
		buttons.push([{ text: '✏️ Custom Amount', callback_data: `partial_custom_${toUserId}_${owedAmount.toFixed(2)}` }]);
		buttons.push([{ text: '❌ Cancel', callback_data: 'close' }]);

		await reply(ctx,
			`💵 <b>Partial Settlement</b>\n\n` +
			`You owe @${toUsername}: <b>$${owedAmount.toFixed(2)}</b>\n\n` +
			`Select an amount to pay:`,
			{
				parse_mode: 'HTML',
				reply_markup: { inline_keyboard: buttons }
			}
		);
	} catch (error) {
		console.error('Error handling partial settlement:', error);
		await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
	}
}

async function handlePartialSettlementCallback(
	ctx: Context,
	db: D1Database,
	owerId: string,
	owedId: string,
	totalAmount: number
) {
	const buttons = [];
	const commonAmounts = [10, 20, 25, 50, 100];
	
	// Get usernames
	const users = await db.prepare(`
		SELECT telegram_id, username, first_name
		FROM users
		WHERE telegram_id IN (?, ?)
	`).bind(owerId, owedId).all();
	
	const owerUser = users.results.find(u => u.telegram_id === owerId);
	const owedUser = users.results.find(u => u.telegram_id === owedId);
	
	const owerName = owerUser?.username || owerUser?.first_name || 'User';
	const owedName = owedUser?.username || owedUser?.first_name || 'User';
	
	// Add quick amount buttons
	for (const amt of commonAmounts) {
		if (amt < totalAmount) {
			buttons.push([{ 
				text: `💵 Pay $${amt}`, 
				callback_data: `partial_pay_${owerId}_${owedId}_${amt}` 
			}]);
		}
	}
	
	// Add percentage buttons
	buttons.push([
		{ text: '25%', callback_data: `partial_pay_${owerId}_${owedId}_${(totalAmount * 0.25).toFixed(2)}` },
		{ text: '50%', callback_data: `partial_pay_${owerId}_${owedId}_${(totalAmount * 0.50).toFixed(2)}` },
		{ text: '75%', callback_data: `partial_pay_${owerId}_${owedId}_${(totalAmount * 0.75).toFixed(2)}` }
	]);
	
	// Add custom amount option
	buttons.push([{ text: '✏️ Custom Amount', callback_data: `partial_custom_${owerId}_${owedId}_${totalAmount.toFixed(2)}` }]);
	buttons.push([{ text: '◀️ Back', callback_data: 'show_settle_balances' }]);

	await ctx.editMessageText(
		`💵 <b>Partial Settlement</b>\n\n` +
		`@${owerName} owes @${owedName}: <b>$${totalAmount.toFixed(2)}</b>\n\n` +
		`Select an amount to pay:`,
		{
			parse_mode: 'HTML',
			reply_markup: { inline_keyboard: buttons }
		}
	);
}