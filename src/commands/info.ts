import { Context } from 'grammy';
import { COMMANDS } from '../utils/constants';
import { reply } from '../utils/reply';

const COMMAND_INFO: { [key: string]: { syntax: string; description: string; examples: string[]; notes?: string[] } } = {
	[COMMANDS.ADD]: {
		syntax: '/add [amount] [description] [@mentions] [options]',
		description: 'Add a new expense with flexible splitting options',
		examples: [
			'/add 120 lunch - Split $120 evenly with all group members',
			'/add 120 lunch @john @sarah - Split evenly between you, John, and Sarah',
			'/add 120 lunch @john=50 @sarah=70 - John pays $50, Sarah pays $70',
			'/add 100 dinner @john=60% @sarah=40% - Split by percentage',
			'/add 90 pizza @john=2 @sarah=1 - Split by shares (2:1 ratio)',
			'/add 50 coffee paid:@john - John paid, split with everyone',
			'/add 30 lunch paid:@john @sarah - John paid, split only with Sarah (you excluded)',
			'/add 15.99 taxi paid:@sarah @john @mike - Sarah paid, split with John and Mike only',
		],
		notes: [
			'paid:@user must come after description, before other mentions',
			'When using paid:@user with specific mentions, you are excluded from the split',
			'When using paid:@user without mentions, everyone including you is included',
			'Amounts can have decimals (e.g., 15.99)',
			'Auto-categorization suggests categories based on description',
			'Users not in FinPals will be notified when they join',
		],
	},
	[COMMANDS.EDIT]: {
		syntax: '/edit [expense_id] [field] [new_value]',
		description: 'Edit an existing expense',
		examples: [
			'/edit abc123 amount 150 - Change amount to $150',
			'/edit abc123 description "Team lunch at Pizza Place" - Update description',
			'/edit abc123 category "Food & Dining" - Change category',
			'/edit abc123 splits @john=60 @sarah=90 - Modify split amounts',
		],
		notes: [
			'Valid fields: amount, description, category, splits',
			'Get expense ID from /expenses command',
			'Only expense creator can edit',
			'Use quotes for multi-word values',
		],
	},
	[COMMANDS.SETTLE]: {
		syntax: '/settle @user [amount|"partial"]',
		description: 'Record a payment between users',
		examples: [
			'/settle @john 50 - Record $50 payment to John',
			'/settle @sarah partial - Open dialog for partial payment',
			'/settle @mike 125.50 - Settle exact amount with Mike',
		],
		notes: [
			'Validates against actual debt amounts',
			'Creates a settlement record for history',
			'Both parties receive notifications',
			'Use "partial" for interactive partial payment',
		],
	},
	[COMMANDS.RECURRING]: {
		syntax: '/recurring [action] [options]',
		description: 'Manage recurring expenses',
		examples: [
			'/recurring create 1500 rent monthly - Monthly rent',
			'/recurring create 50 internet weekly - Weekly internet',
			'/recurring list - View all recurring expenses',
			'/recurring pause abc123 - Pause a recurring expense',
			'/recurring resume abc123 - Resume a paused expense',
			'/recurring delete abc123 - Delete a recurring expense',
		],
		notes: [
			'Supports: daily, weekly, monthly frequencies',
			'Expenses created automatically on schedule',
			'Can pause/resume without losing configuration',
			'Notifies all participants when created',
		],
	},
	[COMMANDS.TEMPLATES]: {
		syntax: '/templates [action] [options]',
		description: 'Create reusable expense templates',
		examples: [
			'/templates - View all your templates',
			'/templates create coffee 5 "Morning coffee" - Create template',
			'/templates create lunch 15 "Office lunch" @john @sarah - With default splits',
			'/templates shortcut coffee /cof - Create /cof shortcut',
			'/templates delete abc123 - Delete a template',
			'/cof - Use shortcut to add coffee expense',
		],
		notes: [
			'Templates save time for frequent expenses',
			'Can include default participants and splits',
			'Shortcuts must be 3-10 characters',
			'Personal templates work in DM and groups',
		],
	},
	[COMMANDS.BUDGET]: {
		syntax: '/budget [action] [options]',
		description: 'Set and track spending budgets',
		examples: [
			'/budget - View all budgets and current spending',
			'/budget set 500 monthly "Food & Dining" - $500/month food budget',
			'/budget set 100 weekly Entertainment - $100/week entertainment',
			'/budget edit abc123 600 - Update budget amount',
			'/budget delete abc123 - Remove a budget',
			'/budget alerts on - Enable budget notifications',
			'/budget alerts off - Disable notifications',
		],
		notes: [
			'Tracks spending across all groups',
			'Alerts at 80% and 100% of budget',
			'Supports weekly and monthly periods',
			'Personal budgets only (not group budgets)',
		],
	},
	[COMMANDS.TRIP]: {
		syntax: '/trip [action] [name]',
		description: 'Track trip/vacation expenses separately',
		examples: [
			'/trip start "Bali Vacation" - Start tracking trip expenses',
			'/trip start "Team Retreat 2024" - Start work trip tracking',
			'/trip current - View active trip details',
			'/trip end - End current trip and see summary',
			'/trip summary abc123 - View specific trip summary',
		],
		notes: [
			'Only one active trip per group at a time',
			'All expenses during trip are tagged automatically',
			'Trip summary shows total costs and per-person shares',
			'Previous trips accessible via /trips command',
		],
	},
	[COMMANDS.EXPORT]: {
		syntax: '/export [format] [options]',
		description: 'Export expense data',
		examples: [
			'/export - Export all expenses as CSV',
			'/export csv month - Export current month only',
			'/export csv year - Export current year',
			'/export csv trip - Export active trip expenses',
			'/export csv "2024-01" - Export specific month',
		],
		notes: [
			'CSV format includes all expense details',
			'Exports are sent as downloadable files',
			'Includes categories, participants, and settlements',
			'Personal exports include only your expenses',
		],
	},
	[COMMANDS.SUMMARY]: {
		syntax: '/summary [period]',
		description: 'View expense summaries and analytics',
		examples: [
			'/summary - Current month summary',
			'/summary 2024-01 - Specific month (YYYY-MM)',
			'/summary last - Last month summary',
			'/summary year - Current year summary',
		],
		notes: [
			'Shows total spent, received, and net balance',
			'Breaks down by category with percentages',
			'Includes settlement statistics',
			'Compares to previous period',
		],
	},
	[COMMANDS.FRIEND]: {
		syntax: '/friend @username',
		description: 'View shared expenses with a specific person',
		examples: ['/friend @john - See all expenses with John', '/friend @sarah - View balance across all groups with Sarah'],
		notes: [
			'Shows net balance across all shared groups',
			'Lists expenses grouped by chat/group',
			'Includes both owed and owing amounts',
			'Works only for users enrolled in FinPals',
		],
	},
	[COMMANDS.ACTIVITY]: {
		syntax: '/activity [options]',
		description: 'View recent expense activity',
		examples: [
			'/activity - Show last 10 activities in group',
			'/activity 20 - Show last 20 activities',
			'/activity all - Show all recent activities',
		],
		notes: [
			'Shows expenses and settlements chronologically',
			'In private chat, shows personal expenses',
			'Includes who added each expense',
			'Limited to activities from last 30 days',
		],
	},
	[COMMANDS.BALANCE]: {
		syntax: '/balance',
		description: 'View who owes whom in the group',
		examples: ['/balance - Show all debts with auto-simplification'],
		notes: [
			'Automatically simplifies debts for fewer transactions',
			'Shows optimal payment plan',
			'Green = you receive, Red = you owe',
			'Updates in real-time as expenses are added',
		],
	},
};

export async function handleInfo(ctx: Context) {
	const args = ctx.message?.text?.split(' ').slice(1) || [];

	if (args.length === 0) {
		// Show available commands
		const commandList = Object.keys(COMMAND_INFO)
			.map((cmd) => `• /${cmd}`)
			.join('\n');

		await reply(
			ctx,
			`📚 <b>Command Information</b>\n\n` +
				`Use <code>/info [command]</code> to get detailed help\n\n` +
				`<b>Available commands:</b>\n${commandList}\n\n` +
				`Example: <code>/info add</code>`,
			{ parse_mode: 'HTML' },
		);
		return;
	}

	const command = args[0].replace('/', '').toLowerCase();
	const info = COMMAND_INFO[command];

	if (!info) {
		await reply(ctx, `❌ Unknown command: ${command}\n\n` + `Use /info to see available commands`, { parse_mode: 'HTML' });
		return;
	}

	let message = `📖 <b>/${command} Command</b>\n\n`;
	message += `<b>Syntax:</b>\n<code>${info.syntax}</code>\n\n`;
	message += `<b>Description:</b>\n${info.description}\n\n`;
	message += `<b>Examples:</b>\n`;
	message += info.examples.map((ex) => `• <code>${ex}</code>`).join('\n');

	if (info.notes && info.notes.length > 0) {
		message += `\n\n<b>Notes:</b>\n`;
		message += info.notes.map((note) => `• ${note}`).join('\n');
	}

	await reply(ctx, message, {
		parse_mode: 'HTML',
		reply_markup: {
			inline_keyboard: [[{ text: '📚 All Commands', callback_data: 'info_list' }], [{ text: '❌ Close', callback_data: 'close' }]],
		},
	});
}
