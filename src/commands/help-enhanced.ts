import { Context } from 'grammy';
import { COMMANDS } from '../utils/constants';

export async function handleHelp(ctx: Context, db?: D1Database) {
	const isPrivate = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();
	
	let helpMessage = '';
	let templateShortcuts = '';
	
	// Try to get user's template shortcuts if database is provided
	if (db && userId) {
		try {
			const shortcuts = await db
				.prepare(`
					SELECT shortcut, name 
					FROM expense_templates 
					WHERE user_id = ? 
						AND shortcut IS NOT NULL 
						AND deleted = FALSE
					ORDER BY usage_count DESC
					LIMIT 5
				`)
				.bind(userId)
				.all();
				
			if (shortcuts.results && shortcuts.results.length > 0) {
				templateShortcuts = '\n<b>⚡ Quick Templates:</b>\n';
				shortcuts.results.forEach((t: any) => {
					templateShortcuts += `/${t.shortcut} - ${t.name}\n`;
				});
			}
		} catch (error) {
			console.error('Error fetching template shortcuts:', error);
		}
	}
	
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

<b>📋 Expense Templates:</b>
/${COMMANDS.TEMPLATES} - Manage quick expense templates
• Create templates for frequent expenses
• Use shortcuts like /coffee for instant tracking
${templateShortcuts}

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
• Use /info [command] for detailed help
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
• <code>/add 50 coffee paid:@john</code> - John paid, split with all
• <code>/add 30 lunch paid:@john @sarah</code> - John paid, split only with Sarah (excludes you)

/${COMMANDS.EXPENSES} - Browse all expenses with actions
/${COMMANDS.EDIT} <code>[id] [field] [value]</code> - Edit expense
/${COMMANDS.DELETE} <code>[id]</code> - Delete an expense
/${COMMANDS.CATEGORY} <code>[id] [category]</code> - Categorize expense

<b>📋 Quick Templates:</b>
/${COMMANDS.TEMPLATES} - Create & manage expense templates
• Set up templates for frequent expenses
• Use shortcuts for instant tracking
${templateShortcuts}

<b>📅 Recurring Expenses:</b>
/${COMMANDS.RECURRING} - Manage recurring expenses
• Set up monthly rent, weekly groceries, etc.
• Expenses created automatically
• Pause/resume anytime

<b>💰 Balance & Settlements:</b>
/${COMMANDS.BALANCE} - Who owes whom
/${COMMANDS.SETTLE} <code>@user [amount]</code> - Record payment
/${COMMANDS.SETTLE} <code>@user partial</code> - Make partial payment
/${COMMANDS.HISTORY} - Recent transactions

<b>🏝 Trip Management:</b>
/${COMMANDS.TRIP} <code>start [name]</code> - Start a new trip
/${COMMANDS.TRIP} <code>end</code> - End current trip
/${COMMANDS.TRIP} <code>current</code> - View active trip
/${COMMANDS.TRIPS} - List all trips

<b>📊 Analytics:</b>
/${COMMANDS.STATS} - Group statistics
/${COMMANDS.SUMMARY} <code>[month]</code> - Monthly summary
/${COMMANDS.ACTIVITY} - Recent activity feed
/${COMMANDS.FRIEND} <code>@user</code> - View shared expenses with a friend
/${COMMANDS.SEARCH} <code>[query]</code> - Search expenses
/${COMMANDS.EXPORT} - Export to CSV

<b>👥 Group Management:</b>
/${COMMANDS.STATUS} - Check who's enrolled in FinPals

<b>🤖 Private Chat Features:</b>
• DM me to track personal expenses
• Set budgets and spending limits
• View cross-group summaries with /personal

<b>💡 Tips:</b>
• Custom splits: @user=amount
• Auto-categorization learns from you
• Members auto-enroll by sending a message
• Use /status to see who's enrolled
• I'll DM people when they're added to expenses
• Use /info [command] for detailed command help
		`;
	}

	await ctx.reply(helpMessage, {
		parse_mode: 'HTML',
		reply_markup: {
			inline_keyboard: [
				[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }],
				[{ text: '📊 View Balance', callback_data: 'view_balance' }],
				[{ text: '📋 Templates', callback_data: 'view_templates' }],
			],
		},
	});
}