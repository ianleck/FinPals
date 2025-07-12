export const BOT_USERNAME = '@FinPalsBot';

export const DEFAULT_CURRENCY = 'USD';

export const SUPPORTED_CURRENCIES = [
	'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'SGD', 'INR', 'AUD', 'CAD',
	'KRW', 'THB', 'MYR', 'PHP', 'IDR', 'VND', 'HKD', 'TWD', 'NZD',
	'CHF', 'SEK', 'NOK', 'DKK', 'ZAR', 'AED', 'SAR', 'BRL', 'MXN',
	'TRY', 'RUB'
];

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

I'll help track your group's shared expenses.

<b>Quick Start:</b>
• <code>/add 50 lunch</code> - Split $50 with everyone
• <code>/add 30 coffee @john</code> - Split $30 with John
• <code>/balance</code> - See who owes whom
• <code>/settle @sarah 20</code> - Record a payment

<b>More Commands:</b>
• <code>/status</code> - See who's enrolled
• <code>/expenses</code> - Browse all expenses
• <code>/help</code> - View all features

💡 <b>Note:</b> Members are enrolled when they send any message.

Ready? Try: <code>/add 20 coffee</code>
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
	TEMPLATES: 'templates',
	STATUS: 'status',
	ENROLL_ALL: 'enroll_all',
};

export const ERROR_MESSAGES = {
	INVALID_AMOUNT: 'Please enter a valid number',
	NO_PARTICIPANTS: 'Tag people to split with (@username)',
	USER_NOT_IN_GROUP: 'Please add the user to the group first',
	DATABASE_ERROR: 'Something went wrong. Please try again.',
	RATE_LIMITED: 'Too many requests. Please wait a moment.',
};
