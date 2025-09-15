/**
 * Navigation and utility callback handlers
 * Handles general navigation, history, stats, and help callbacks
 */

import { Bot, Context } from 'grammy';
import { createDb } from '../db';
import { handleHistory } from '../commands/history';
import { handleStats } from '../commands/stats';
import { handleInfo } from '../commands/info';
import { logger } from '../utils/logger';
import type { Env } from '../index';

type MyContext = Context & { env: Env };

/**
 * Registers all navigation-related callback handlers
 */
export function registerNavigationCallbacks(bot: Bot<MyContext>) {
	// History and stats
	bot.callbackQuery('view_history', handleViewHistory);
	bot.callbackQuery('view_stats', handleViewStats);
	bot.callbackQuery('view_trends', handleViewTrends);

	// Help and info
	bot.callbackQuery('info_list', handleInfoList);
	bot.callbackQuery('search_help', handleSearchHelp);

	// General navigation
	bot.callbackQuery('close', handleClose);
	bot.callbackQuery(/^edit_split:/, handleEditSplit);
}

async function handleViewHistory(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const db = createDb(ctx.env);
	await handleHistory(ctx, db);
}

async function handleViewStats(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const db = createDb(ctx.env);
	await handleStats(ctx, db);
}

async function handleViewTrends(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	const groupId = ctx.chat?.id.toString();
	if (!groupId) return;

	const db = createDb(ctx.env);

	try {
		const { generateSpendingTrends, formatTrendsMessage } = await import('../utils/spending-visualization');
		const { trends, categoryTrends, insights } = await generateSpendingTrends(db, groupId);
		const trendsMessage = formatTrendsMessage(trends, categoryTrends, insights);

		await ctx.reply(trendsMessage, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [[{ text: '📊 Back to Stats', callback_data: 'view_stats' }], [{ text: '❌ Close', callback_data: 'close' }]],
			},
		});
	} catch (error) {
		logger.error('Error getting trends', error);
		await ctx.reply('❌ Error loading trends. Please try again.');
	}
}

async function handleInfoList(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	await handleInfo(ctx);
}

async function handleSearchHelp(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	await ctx.reply(
		'🔍 <b>Search Help</b>\n\n' +
			'You can search by:\n' +
			'• <b>Text:</b> /search lunch\n' +
			'• <b>Amount:</b> /search >50\n' +
			'• <b>Range:</b> /search 20-100\n' +
			'• <b>Person:</b> /search @john\n' +
			'• <b>Date:</b> /search yesterday\n' +
			'• <b>Combine:</b> /search coffee last week\n\n' +
			'More examples:\n' +
			'• /search dinner >30\n' +
			'• /search @sarah last month\n' +
			'• /search uber 10-50',
		{ parse_mode: 'HTML' },
	);
}

async function handleClose(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	await ctx.deleteMessage();
}

async function handleEditSplit(ctx: MyContext) {
	await ctx.answerCallbackQuery();
	await ctx.reply(
		'✏️ Edit split functionality coming soon!\n\n' + 'For now, you can delete the expense and create a new one with the correct split.',
		{ parse_mode: 'HTML' },
	);
}
