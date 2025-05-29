import { Context } from 'grammy';
import { WelcomeMessage } from '../utils/constants';

export async function handleStart(ctx: Context) {
	const chatType = ctx.chat?.type;
	const username = ctx.from?.username || ctx.from?.first_name || 'there';

	if (chatType === 'private') {
		// Private chat welcome
		await ctx.reply(
			`👋 Welcome ${username}!\n\n` +
				`I'm FinPals - your expense splitting assistant for Telegram groups.\n\n` +
				`To get started:\n` +
				`1️⃣ Add me to your group chat\n` +
				`2️⃣ Make me an admin (so I can read messages)\n` +
				`3️⃣ Start tracking expenses!\n\n` +
				`Use /help to see all available commands.`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
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
