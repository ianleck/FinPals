/**
 * Settlement-related callback handlers
 * Handles payment recording, balance viewing, and debt simplification
 */

import { Bot, Context } from 'grammy';
import { eq, and, or, sql } from 'drizzle-orm';
import { createDb, withRetry } from '../db';
import { settlements, users } from '../db/schema';
import { getFirstResult } from '../utils/db-helpers';
import { logger } from '../utils/logger';
import { handleBalance } from '../commands/balance';
import { handleSettleCallback, showUnsettledBalances } from '../commands/settle';
import type { Env } from '../index';

type MyContext = Context & { env: Env };

/**
 * Registers all settlement-related callback handlers
 */
export function registerSettlementCallbacks(bot: Bot<MyContext>) {
	// Balance viewing
	bot.callbackQuery('view_balance', handleViewBalance);
	bot.callbackQuery(/^simplify_debts:(.*)$/, handleSimplifyDebts);

	// Settlement recording
	bot.callbackQuery('settle_help', handleSettleHelp);
	bot.callbackQuery('show_settle_balances', handleShowSettleBalances);
	bot.callbackQuery(/^settle_/, handleSettleButton);

	// Partial payments
	bot.callbackQuery(/^partial_pay_/, handlePartialPayment);
	bot.callbackQuery(/^partial_custom_/, handlePartialCustom);
}

async function handleViewBalance(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	await handleBalance(ctx, ctx.env);
}

async function handleSimplifyDebts(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const tripId = ctx.match?.[1] || undefined;
	const groupId = ctx.chat?.id.toString();
	const db = createDb(ctx.env);

	if (!groupId) return;

	try {
		const { getSimplifiedSettlementPlan } = await import('../utils/debt-simplification');
		const { transactions, message } = await getSimplifiedSettlementPlan(db, groupId, tripId);

		const buttons = [];
		if (transactions.length > 0) {
			buttons.push([{ text: '💸 Start Settling', callback_data: 'show_settle_balances' }]);
		}
		buttons.push([{ text: '◀️ Back to Balance', callback_data: 'view_balance' }]);

		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: { inline_keyboard: buttons },
		});
	} catch (error) {
		logger.error('Error simplifying debts', error);
		await ctx.reply('❌ Error calculating simplified settlements.');
	}
}

async function handleSettleHelp(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	await ctx.reply(
		'💸 <b>Recording Settlements</b>\n\n' +
			'Use: <code>/settle @username [amount]</code>\n\n' +
			'This records that you paid the mentioned user.\n\n' +
			'Example: <code>/settle @john 25</code>\n' +
			'This means you paid John $25.',
		{ parse_mode: 'HTML' },
	);
}

async function handleShowSettleBalances(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const db = createDb(ctx.env);
	await showUnsettledBalances(ctx, db);
}

async function handleSettleButton(ctx: MyContext) {
	const db = createDb(ctx.env);
	await handleSettleCallback(ctx, db);
}

async function handlePartialPayment(ctx: MyContext) {
	if (!ctx.callbackQuery?.data || !ctx.from) {
		await ctx.answerCallbackQuery('Invalid callback data');
		return;
	}
	const parts = ctx.callbackQuery.data.split('_');
	let owerId: string, owedId: string, amount: number;
	const db = createDb(ctx.env);

	if (parts.length === 4) {
		// From partial settlement command: partial_pay_{toUserId}_{amount}
		owedId = parts[2];
		owerId = ctx.from!.id.toString();
		amount = parseFloat(parts[3]);
	} else {
		// From balance view: partial_pay_{owerId}_{owedId}_{amount}
		owerId = parts[2];
		owedId = parts[3];
		amount = parseFloat(parts[4]);
	}

	const groupId = ctx.chat?.id.toString();
	if (!groupId) return;

	await ctx.answerCallbackQuery();

	// Record the partial settlement
	const settlementId = crypto.randomUUID();
	await db.insert(settlements).values({
		id: settlementId,
		groupId: groupId,
		fromUser: owerId,
		toUser: owedId,
		amount: amount.toString(),
		createdBy: ctx.from!.id.toString(),
	});

	// Get usernames
	const usersResult = await db
		.select({
			telegram_id: users.telegramId,
			username: users.username,
			first_name: users.firstName,
		})
		.from(users)
		.where(or(eq(users.telegramId, owerId), eq(users.telegramId, owedId)));

	const owerUser = usersResult.find((u) => u.telegram_id === owerId);
	const owedUser = usersResult.find((u) => u.telegram_id === owedId);

	const owerName = owerUser?.username || owerUser?.first_name || 'User';
	const owedName = owedUser?.username || owedUser?.first_name || 'User';

	// Get remaining balance
	const remainingBalanceResult = await db.execute(sql`
		WITH expense_balances AS (
			SELECT
				e.paid_by as creditor,
				es.user_id as debtor,
				SUM(es.amount) as amount
			FROM expenses e
			JOIN expense_splits es ON e.id = es.expense_id
			WHERE e.group_id = ${groupId} AND e.deleted = FALSE
				AND ((e.paid_by = ${owerId} AND es.user_id = ${owedId}) OR (e.paid_by = ${owedId} AND es.user_id = ${owerId}))
			GROUP BY e.paid_by, es.user_id
		),
		settlement_balances AS (
			SELECT
				to_user as creditor,
				from_user as debtor,
				SUM(amount) as amount
			FROM settlements
			WHERE group_id = ${groupId}
				AND ((to_user = ${owerId} AND from_user = ${owedId}) OR (to_user = ${owedId} AND from_user = ${owerId}))
			GROUP BY to_user, from_user
		)
		SELECT
				SUM(CASE
					WHEN creditor = ${owedId} AND debtor = ${owerId} THEN amount
					WHEN creditor = ${owerId} AND debtor = ${owedId} THEN -amount
					ELSE 0
				END) as net_balance
		FROM (
			SELECT creditor, debtor, amount FROM expense_balances
			UNION ALL
			SELECT creditor, debtor, -amount FROM settlement_balances
		)
	`);

	const remainingBalance = getFirstResult<any>(remainingBalanceResult);

	const remaining = Math.abs((remainingBalance?.net_balance as number) || 0);

	let message = `💵 <b>Partial Payment Recorded</b>\n\n`;
	message += `@${owerName} paid @${owedName}: <b>$${amount.toFixed(2)}</b>\n\n`;

	if (remaining < 0.01) {
		message += `✅ All settled up!`;
	} else {
		message += `💰 Remaining: <b>$${remaining.toFixed(2)}</b>`;
	}

	await ctx.editMessageText(message, {
		parse_mode: 'HTML',
		reply_markup: {
			inline_keyboard: [[{ text: '📊 View All Balances', callback_data: 'view_balance' }]],
		},
	});

	// Send notification
	try {
		await ctx.api.sendMessage(
			owedId,
			`💵 <b>Partial Payment Received!</b>\n\n` +
				`@${owerName} paid you <b>$${amount.toFixed(2)}</b>\n` +
				`Group: ${ctx.chat?.title || 'your group'}\n` +
				`Remaining: $${remaining.toFixed(2)}`,
			{ parse_mode: 'HTML' },
		);
	} catch {
		// User might have blocked the bot
	}
}

async function handlePartialCustom(ctx: MyContext) {
	await ctx.answerCallbackQuery('Please type the amount you want to pay');
	if (!ctx.callbackQuery?.data) {
		return;
	}
	const parts = ctx.callbackQuery.data.split('_');
	const db = createDb(ctx.env);

	let instruction = '';
	if (parts.length === 4) {
		// From partial command
		const toUserId = parts[2];
		const totalOwed = parts[3];

		const userResult = await db
			.select({
				username: users.username,
				first_name: users.firstName,
			})
			.from(users)
			.where(eq(users.telegramId, toUserId))
			.limit(1);

		const user = userResult[0];

		const username = user?.username || user?.first_name || 'User';
		instruction = `💵 You owe @${username} $${totalOwed}\n\n`;
	}

	instruction += 'Please type the amount you want to pay:\n';
	instruction += 'Example: 15.50';

	await ctx.editMessageText(instruction, { parse_mode: 'HTML' });
}
