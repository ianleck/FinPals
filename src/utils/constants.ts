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

⚠️ <b>Important Setup:</b>
Due to Telegram limitations, I can't see all group members yet. To get started:

1️⃣ Make me admin (optional but recommended)
2️⃣ Ask everyone to send a quick message
3️⃣ Use <code>/status</code> to check who's enrolled

<b>Quick Commands:</b>
• <code>/add 50 lunch</code> - Split with everyone enrolled
• <code>/add 30 coffee @john</code> - Split with specific people
• <code>/balance</code> - See who owes whom
• <code>/settle @sarah 20</code> - Record a payment

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
	EDIT: 'edit',
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
	RECURRING: 'recurring',
	STATUS: 'status',
	ENROLL_ALL: 'enroll_all',
	ACTIVITY: 'activity',
	FRIEND: 'friend',
	INFO: 'info',
	FIX_DUPLICATES: 'fixduplicates',
};

export const ERROR_MESSAGES = {
	INVALID_AMOUNT: 'Please enter a valid number',
	NO_PARTICIPANTS: 'Tag people to split with (@username)',
	USER_NOT_IN_GROUP: 'Please add the user to the group first',
	DATABASE_ERROR: 'Something went wrong. Please try again.',
	RATE_LIMITED: 'Too many requests. Please wait a moment.',
};
