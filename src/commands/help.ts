import { Context } from 'grammy';
import { COMMANDS } from '../utils/constants';

export async function handleHelp(ctx: Context) {
	const helpMessage = `
📚 <b>FinPals Commands</b>

<b>💵 Expense Management:</b>
/${COMMANDS.ADD} <code>[amount] [description] [@mentions]</code>
Add expense with even or custom splits
<i>Examples:</i>
• <code>/add 120 lunch</code> - Split evenly with all
• <code>/add 120 lunch @john @sarah</code> - Split evenly between mentioned
• <code>/add 120 lunch @john=50 @sarah=70</code> - Custom amounts

/${COMMANDS.EXPENSES} - Browse all expenses with actions
/${COMMANDS.DELETE} <code>[id]</code> - Delete an expense
/${COMMANDS.CATEGORY} <code>[id] [category]</code> - Categorize expense

<b>💰 Balance & Settlements:</b>
/${COMMANDS.BALANCE} - Who owes whom
/${COMMANDS.SETTLE} <code>@user [amount]</code> - Record payment
/${COMMANDS.HISTORY} - Recent transactions

<b>🏝 Trip Management:</b>
/${COMMANDS.TRIP} <code>start [name]</code> - Start a new trip
/${COMMANDS.TRIP} <code>end</code> - End current trip
/${COMMANDS.TRIP} <code>current</code> - View active trip
/${COMMANDS.TRIPS} - List all trips

<b>📊 Analytics:</b>
/${COMMANDS.STATS} - Group statistics
/${COMMANDS.SUMMARY} <code>[month]</code> - Monthly summary
/${COMMANDS.EXPORT} - Export to CSV
/${COMMANDS.PERSONAL} - Your cross-group summary (DM only)

<b>💡 Tips:</b>
• Custom splits: @user=amount
• Auto-categorization learns from you
• Members need to message once to be tracked
• I'll DM people when they're added to expenses

Need help? Contact @FinPalsSupport
	`;

	await ctx.reply(helpMessage, {
		parse_mode: 'HTML',
		reply_markup: {
			inline_keyboard: [
				[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }],
				[{ text: '📊 View Balance', callback_data: 'view_balance' }],
			],
		},
	});
}
