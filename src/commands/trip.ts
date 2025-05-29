import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';

export async function handleTrip(ctx: Context, db: D1Database): Promise<void> {
	if (!ctx.from || !ctx.chat || ctx.chat.type === 'private') {
		await ctx.reply('❌ This command only works in group chats.');
		return;
	}

	const args = ctx.message?.text?.split(' ').slice(1) || [];
	
	if (args.length === 0) {
		await ctx.reply(
			`📍 <b>Trip Management</b>\n\n` +
			`Use these commands to manage trips:\n\n` +
			`• /trip start &lt;name&gt; - Start a new trip\n` +
			`• /trip end - End the current trip\n` +
			`• /trip current - View current trip\n` +
			`• /trips - List all trips\n\n` +
			`<i>Expenses will be automatically linked to the active trip!</i>`,
			{ parse_mode: 'HTML' }
		);
		return;
	}

	const action = args[0].toLowerCase();
	const groupId = ctx.chat.id.toString();
	const userId = ctx.from.id.toString();

	try {
		switch (action) {
			case 'start':
				await startTrip(ctx, db, groupId, userId, args.slice(1));
				break;
			case 'end':
				await endTrip(ctx, db, groupId, userId);
				break;
			case 'current':
				await showCurrentTrip(ctx, db, groupId);
				break;
			default:
				await ctx.reply('❌ Invalid action. Use /trip for help.');
		}
	} catch (error) {
		console.error('Error managing trip:', error);
		await ctx.reply(ERROR_MESSAGES.DATABASE_ERROR);
	}
}

async function startTrip(ctx: Context, db: D1Database, groupId: string, userId: string, args: string[]): Promise<void> {
	if (args.length === 0) {
		await ctx.reply('❌ Please provide a name for the trip.\nExample: /trip start Weekend Getaway');
		return;
	}

	// Check if there's already an active trip
	const activeTrip = await db.prepare(`
		SELECT * FROM trips 
		WHERE group_id = ? AND status = 'active'
		LIMIT 1
	`).bind(groupId).first();

	if (activeTrip) {
		await ctx.reply(
			`⚠️ <b>Active Trip Exists</b>\n\n` +
			`Trip "<b>${activeTrip.name}</b>" is currently active.\n` +
			`Please end it first with /trip end`,
			{ parse_mode: 'HTML' }
		);
		return;
	}

	const tripName = args.join(' ');
	const tripId = crypto.randomUUID();

	// Create new trip
	await db.prepare(`
		INSERT INTO trips (id, group_id, name, created_by, status)
		VALUES (?, ?, ?, ?, 'active')
	`).bind(tripId, groupId, tripName, userId).run();

	await ctx.reply(
		`✅ <b>Trip Started!</b>\n\n` +
		`🏝 <b>${tripName}</b>\n\n` +
		`All new expenses will be linked to this trip.\n` +
		`Use /trip end when you're done!`,
		{ 
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '➕ Add Expense', callback_data: 'add_expense_help' }],
					[{ text: '📊 View Balances', callback_data: 'view_balance' }]
				]
			}
		}
	);
}

async function endTrip(ctx: Context, db: D1Database, groupId: string, userId: string): Promise<void> {
	// Get active trip
	const activeTrip = await db.prepare(`
		SELECT * FROM trips 
		WHERE group_id = ? AND status = 'active'
		LIMIT 1
	`).bind(groupId).first();

	if (!activeTrip) {
		await ctx.reply('❌ No active trip found. Start one with /trip start <name>');
		return;
	}

	// Get trip statistics
	const stats = await db.prepare(`
		SELECT 
			COUNT(DISTINCT e.id) as expense_count,
			COALESCE(SUM(e.amount), 0) as total_amount,
			COUNT(DISTINCT e.paid_by) as participants
		FROM expenses e
		WHERE e.trip_id = ? AND e.deleted = FALSE
	`).bind(activeTrip.id).first();

	// End the trip
	await db.prepare(`
		UPDATE trips 
		SET status = 'ended', ended_at = datetime('now')
		WHERE id = ?
	`).bind(activeTrip.id).run();

	await ctx.reply(
		`✅ <b>Trip Ended!</b>\n\n` +
		`🏝 <b>${activeTrip.name}</b>\n\n` +
		`📊 <b>Summary:</b>\n` +
		`• Expenses: ${stats?.expense_count || 0}\n` +
		`• Total Spent: $${((stats?.total_amount as number) || 0).toFixed(2)}\n` +
		`• Participants: ${stats?.participants || 0}\n\n` +
		`Use /balance to see final balances for this trip!`,
		{ 
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 Trip Balance', callback_data: `trip_balance_${activeTrip.id}` }],
					[{ text: '📈 Trip Summary', callback_data: `trip_summary_${activeTrip.id}` }]
				]
			}
		}
	);
}

async function showCurrentTrip(ctx: Context, db: D1Database, groupId: string): Promise<void> {
	const activeTrip = await db.prepare(`
		SELECT t.*, u.username, u.first_name
		FROM trips t
		JOIN users u ON t.created_by = u.telegram_id
		WHERE t.group_id = ? AND t.status = 'active'
		LIMIT 1
	`).bind(groupId).first();

	if (!activeTrip) {
		await ctx.reply(
			`❌ <b>No Active Trip</b>\n\n` +
			`Start a new trip with:\n` +
			`/trip start &lt;name&gt;`,
			{ parse_mode: 'HTML' }
		);
		return;
	}

	// Get trip statistics
	const stats = await db.prepare(`
		SELECT 
			COUNT(DISTINCT e.id) as expense_count,
			COALESCE(SUM(e.amount), 0) as total_amount,
			COUNT(DISTINCT e.paid_by) as participants
		FROM expenses e
		WHERE e.trip_id = ? AND e.deleted = FALSE
	`).bind(activeTrip.id).first();

	const createdBy = activeTrip.username || activeTrip.first_name || 'Unknown';
	const startDate = new Date(activeTrip.created_at as string).toLocaleDateString();

	await ctx.reply(
		`📍 <b>Current Trip</b>\n\n` +
		`🏝 <b>${activeTrip.name}</b>\n\n` +
		`📅 Started: ${startDate}\n` +
		`👤 Created by: @${createdBy}\n\n` +
		`📊 <b>Statistics:</b>\n` +
		`• Expenses: ${stats?.expense_count || 0}\n` +
		`• Total Spent: $${((stats?.total_amount as number) || 0).toFixed(2)}\n` +
		`• Participants: ${stats?.participants || 0}`,
		{ 
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '➕ Add Expense', callback_data: 'add_expense_help' }],
					[{ text: '📊 View Balances', callback_data: 'view_balance' }],
					[{ text: '🏁 End Trip', callback_data: 'confirm_end_trip' }]
				]
			}
		}
	);
}