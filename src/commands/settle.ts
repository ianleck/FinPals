import { Context } from 'grammy';
import { eq, and, sql, or, inArray } from 'drizzle-orm';
import { type Database, withRetry, formatAmount, parseDecimal } from '../db';
import { users, groups, groupMembers, expenses, expenseSplits, settlements } from '../db/schema';
import { ERROR_MESSAGES } from '../utils/constants';
import { reply } from '../utils/reply';

export async function handleSettle(ctx: Context, db: Database) {
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
		// Check if we have any balance with mentioned users in the group
		const groupMember = await withRetry(async () => {
			const result = await db
				.select({
					telegramId: users.telegramId,
					username: users.username,
					firstName: users.firstName
				})
				.from(users)
				.innerJoin(groupMembers, eq(users.telegramId, groupMembers.userId))
				.where(
					and(
						eq(groupMembers.groupId, groupId),
						eq(groupMembers.active, true),
						eq(users.username, mention.substring(1))
					)
				)
				.limit(1);
			return result[0];
		});

		if (!groupMember) {
			await reply(ctx, 
				`❌ User ${mention} not found in this group.\n\n` +
				'Make sure they have used the bot at least once.',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		const toUserId = groupMember.telegramId;
		const toUsername = groupMember.username || groupMember.firstName || 'User';

		// Calculate current balance between users
		const netBalance = await calculateNetBalance(db, groupId, fromUserId, toUserId);

		// Create settlement
		await withRetry(async () => {
			await db.insert(settlements).values({
				groupId: groupId,
				fromUser: fromUserId,
				toUser: toUserId,
				amount: formatAmount(amount),
				createdBy: fromUserId
			});
		});

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
		await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
	}
}

async function calculateNetBalance(
	db: Database, 
	groupId: string, 
	userId1: string, 
	userId2: string
): Promise<number> {
	return await withRetry(async () => {
		// Get expenses where user1 paid and user2 owes
		const user1PaidExpenses = await db
			.select({
				amount: sql<string>`SUM(${expenseSplits.amount})`
			})
			.from(expenses)
			.innerJoin(expenseSplits, eq(expenses.id, expenseSplits.expenseId))
			.where(
				and(
					eq(expenses.groupId, groupId),
					eq(expenses.deleted, false),
					eq(expenses.paidBy, userId1),
					eq(expenseSplits.userId, userId2)
				)
			);

		// Get expenses where user2 paid and user1 owes
		const user2PaidExpenses = await db
			.select({
				amount: sql<string>`SUM(${expenseSplits.amount})`
			})
			.from(expenses)
			.innerJoin(expenseSplits, eq(expenses.id, expenseSplits.expenseId))
			.where(
				and(
					eq(expenses.groupId, groupId),
					eq(expenses.deleted, false),
					eq(expenses.paidBy, userId2),
					eq(expenseSplits.userId, userId1)
				)
			);

		// Get settlements from user1 to user2
		const user1ToUser2Settlements = await db
			.select({
				amount: sql<string>`SUM(${settlements.amount})`
			})
			.from(settlements)
			.where(
				and(
					eq(settlements.groupId, groupId),
					eq(settlements.fromUser, userId1),
					eq(settlements.toUser, userId2)
				)
			);

		// Get settlements from user2 to user1
		const user2ToUser1Settlements = await db
			.select({
				amount: sql<string>`SUM(${settlements.amount})`
			})
			.from(settlements)
			.where(
				and(
					eq(settlements.groupId, groupId),
					eq(settlements.fromUser, userId2),
					eq(settlements.toUser, userId1)
				)
			);

		const user1Paid = parseDecimal(user1PaidExpenses[0]?.amount || '0');
		const user2Paid = parseDecimal(user2PaidExpenses[0]?.amount || '0');
		const user1Settled = parseDecimal(user1ToUser2Settlements[0]?.amount || '0');
		const user2Settled = parseDecimal(user2ToUser1Settlements[0]?.amount || '0');

		// Net balance: positive means user2 owes user1, negative means user1 owes user2
		return (user1Paid - user1Settled) - (user2Paid - user2Settled);
	});
}

export async function showUnsettledBalances(ctx: Context, db: Database) {
	const groupId = ctx.chat!.id.toString();

	try {
		// Use debt simplification to get optimized settlement plan
		const { simplifyDebts } = await import('../utils/debt-simplification');
		const simplifiedDebts = await simplifyDebts(db, groupId);

		if (simplifiedDebts.length === 0) {
			await reply(ctx, '✅ All settled up! No outstanding balances.');
			return;
		}

		let message = '💳 <b>Unsettled Balances</b> (Simplified)\n\n';
		const inlineButtons = [];

		for (const debt of simplifiedDebts) {
			const { from, to, amount, fromName, toName } = debt;
			message += `@${fromName || 'User'} owes @${toName || 'User'}: <b>$${amount.toFixed(2)}</b>\n`;

			// Create settle buttons with format: settle_{owerId}_{owedId}_{amount}
			const fullButtonText = `💰 Settle $${amount.toFixed(2)}`;
			const fullCallbackData = `settle_${from}_${to}_${amount.toFixed(2)}_full`;
			
			const partialButtonText = `💵 Partial Payment`;
			const partialCallbackData = `settle_${from}_${to}_${amount.toFixed(2)}_partial`;
			
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

export async function handleSettleCallback(ctx: Context, db: Database) {
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
	const userDetails = await withRetry(async () => {
		return await db
			.select({
				telegramId: users.telegramId,
				username: users.username,
				firstName: users.firstName
			})
			.from(users)
			.where(inArray(users.telegramId, [owerId, owedId]));
	});
	
	const owerUser = userDetails.find(u => u.telegramId === owerId);
	const owedUser = userDetails.find(u => u.telegramId === owedId);
	
	const owerName = owerUser?.username || owerUser?.firstName || 'User';
	const owedName = owedUser?.username || owedUser?.firstName || 'User';
	
	// Record the settlement
	await withRetry(async () => {
		await db.insert(settlements).values({
			groupId: groupId,
			fromUser: owerId,
			toUser: owedId,
			amount: formatAmount(amount),
			createdBy: currentUserId
		});
	});
	
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
	db: Database, 
	mention: string, 
	groupId: string, 
	fromUserId: string, 
	fromUsername: string
) {
	try {
		// Get the mentioned user
		const groupMember = await withRetry(async () => {
			const result = await db
				.select({
					telegramId: users.telegramId,
					username: users.username,
					firstName: users.firstName
				})
				.from(users)
				.innerJoin(groupMembers, eq(users.telegramId, groupMembers.userId))
				.where(
					and(
						eq(groupMembers.groupId, groupId),
						eq(groupMembers.active, true),
						eq(users.username, mention.substring(1))
					)
				)
				.limit(1);
			return result[0];
		});

		if (!groupMember) {
			await reply(ctx, 
				`❌ User ${mention} not found in this group.\n\n` +
				'Make sure they have used the bot at least once.',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		const toUserId = groupMember.telegramId;
		const toUsername = groupMember.username || groupMember.firstName || 'User';

		// Get current balance
		const netBalance = await calculateNetBalance(db, groupId, fromUserId, toUserId);

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
	db: Database,
	owerId: string,
	owedId: string,
	totalAmount: number
) {
	const buttons = [];
	const commonAmounts = [10, 20, 25, 50, 100];
	
	// Get usernames
	const userDetails = await withRetry(async () => {
		return await db
			.select({
				telegramId: users.telegramId,
				username: users.username,
				firstName: users.firstName
			})
			.from(users)
			.where(inArray(users.telegramId, [owerId, owedId]));
	});
	
	const owerUser = userDetails.find(u => u.telegramId === owerId);
	const owedUser = userDetails.find(u => u.telegramId === owedId);
	
	const owerName = owerUser?.username || owerUser?.firstName || 'User';
	const owedName = owedUser?.username || owedUser?.firstName || 'User';
	
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