import { Context } from 'grammy';
import { WelcomeMessage } from '../utils/constants';

export async function handleStart(ctx: Context) {
	const chatType = ctx.chat?.type;
	const username = ctx.from?.username || ctx.from?.first_name || 'there';

	if (chatType === 'private') {
		// Private chat welcome
		await ctx.reply(
			`👋 Welcome ${username}!\n\n` +
				`I'm FinPals - your personal finance companion!\n\n` +
				`<b>🏠 In Private Chat:</b>\n` +
				`• Track personal expenses\n` +
				`• Set budgets by category\n` +
				`• View spending analytics\n` +
				`• See summaries across all groups\n\n` +
				`<b>👥 In Group Chat:</b>\n` +
				`• Split expenses with friends\n` +
				`• Track who owes whom\n` +
				`• Manage trips and events\n` +
				`• Export group reports\n\n` +
				`Start with /add to track a personal expense!`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{ text: '💵 Add Personal Expense', callback_data: 'add_expense_help' }],
						[{ text: '💰 Set Budget', callback_data: 'budget_help' }],
						[{ text: '➕ Add to Group', url: 'https://t.me/FinPalsBot?startgroup=true' }],
						[{ text: '❓ Help', callback_data: 'help' }],
					],
				},
			}
		);
	} else {
		// Group chat welcome
		await ctx.reply(WelcomeMessage, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '💵 Add First Expense', callback_data: 'add_expense_help' }],
					[{ text: '❓ View Commands', callback_data: 'help' }],
				],
			},
		});
	}
}
