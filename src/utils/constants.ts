export const BOT_USERNAME = '@FinPalsBot';

export const DEFAULT_CURRENCY = 'USD';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'SGD'];

export const EXPENSE_CATEGORIES = [
	'Food & Dining',
	'Transportation',
	'Entertainment',
	'Shopping',
	'Bills & Utilities',
	'Travel',
	'Healthcare',
	'Education',
	'Other',
];

export const WelcomeMessage = `
👋 <b>Welcome to FinPals!</b>

I'll help your group track shared expenses effortlessly. Here's what I can do:

<b>📍 Core Features:</b>
• /add - Add expenses with smart splitting
• /balance - See who owes whom
• /settle - Record payments
• /expenses - Browse & manage all expenses

<b>🏝 Trip Management:</b>
• /trip start &lt;name&gt; - Start a new trip
• /trip end - End the current trip
• /trip current - View active trip
• /trips - List all trips

<b>📊 Analytics & Export:</b>
• /history - Recent transactions
• /stats - Group statistics
• /summary - Monthly reports
• /export - Download as CSV

<b>🎯 Smart Features:</b>
• Auto-categorization with AI
• Smart participant suggestions
• Interactive buttons (no ID copying!)
• /personal - Your summary across all groups (DM me!)

<b>💡 Pro Tips:</b>
• I'll notify people when they're added to expenses
• Use custom splits: /add 100 dinner @john=30 @sarah=70
• Categories are learned from your patterns

⚠️ <b>Important:</b> Group members need to send at least one message after I join before I can track them!

Ready? Try: /add 20 coffee
`;

export const COMMANDS = {
	START: 'start',
	ADD: 'add',
	BALANCE: 'balance',
	SETTLE: 'settle',
	HISTORY: 'history',
	STATS: 'stats',
	HELP: 'help',
	EXPENSES: 'expenses',
	CATEGORY: 'category',
	DELETE: 'delete',
	CURRENCY: 'currency',
	EXPORT: 'export',
	SUMMARY: 'summary',
	PERSONAL: 'personal',
	TRIP: 'trip',
	TRIPS: 'trips',
	BUDGET: 'budget',
};

export const ERROR_MESSAGES = {
	INVALID_AMOUNT: 'Please enter a valid number',
	NO_PARTICIPANTS: 'Tag people to split with (@username)',
	USER_NOT_IN_GROUP: 'Please add the user to the group first',
	DATABASE_ERROR: 'Something went wrong. Please try again.',
	RATE_LIMITED: 'Too many requests. Please wait a moment.',
};
