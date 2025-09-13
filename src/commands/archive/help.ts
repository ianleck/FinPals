import { Context } from 'grammy';
import { COMMANDS } from '../utils/constants';

export async function handleHelp(ctx: Context) {
	const isPrivate = ctx.chat?.type === 'private';
	
	let helpMessage = '';
	
	if (isPrivate) {
		helpMessage = `
📚 <b>FinPals - Personal Expense Tracking</b>

<b>💵 Track Personal Expenses:</b>
/${COMMANDS.ADD} <code>[amount] [description]</code>
Track personal expenses privately
<i>Examples:</i>
• <code>/add 50 groceries</code>
• <code>/add 30.50 coffee</code>
• <code>/add 120 dinner with friends</code>

/${COMMANDS.EXPENSES} - Browse your expenses
/${COMMANDS.BALANCE} - View spending summary
/${COMMANDS.HISTORY} - Recent transactions
/${COMMANDS.SUMMARY} <code>[month]</code> - Monthly summary

<b>💰 Budget Management:</b>
/${COMMANDS.BUDGET} - Manage personal budgets
• Set monthly/weekly budgets by category
• Get alerts when approaching limits
• Track spending against budgets

<b>📊 Analytics:</b>
/${COMMANDS.PERSONAL} - Cross-group expense summary
• See expenses from all groups you're in
• Understand your total spending patterns

<b>💡 Tips:</b>
• Expenses are private to you only
• Auto-categorization learns from your habits
• Use /personal to see group expenses too
		`;
	} else {
		helpMessage = `
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

<b>🤖 Private Chat Features:</b>
• DM me to track personal expenses
• Set budgets and spending limits
• View cross-group summaries with /personal

<b>💡 Tips:</b>
• Custom splits: @user=amount
• Auto-categorization learns from you
• Members need to message once to be tracked
• I'll DM people when they're added to expenses
		`;
	}

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
