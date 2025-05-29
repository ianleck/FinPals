import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';

export async function handleTrips(ctx: Context, db: D1Database): Promise<void> {
	if (!ctx.from || !ctx.chat || ctx.chat.type === 'private') {
		await ctx.reply('❌ This command only works in group chats.');
		return;
	}

	const groupId = ctx.chat.id.toString();

	try {
		// Get all trips for the group
		const trips = await db.prepare(`
			SELECT 
				t.*,
				u.username,
				u.first_name,
				COUNT(DISTINCT e.id) as expense_count,
				COALESCE(SUM(e.amount), 0) as total_amount
			FROM trips t
			JOIN users u ON t.created_by = u.telegram_id
			LEFT JOIN expenses e ON t.id = e.trip_id AND e.deleted = FALSE
			WHERE t.group_id = ?
			GROUP BY t.id
			ORDER BY t.created_at DESC
			LIMIT 20
		`).bind(groupId).all();

		if (!trips.results || trips.results.length === 0) {
			await ctx.reply(
				`📍 <b>No Trips Found</b>\n\n` +
				`Start your first trip with:\n` +
				`/trip start &lt;name&gt;`,
				{ parse_mode: 'HTML' }
			);
			return;
		}

		let message = `📍 <b>All Trips</b>\n\n`;

		for (const trip of trips.results) {
			const createdBy = trip.username || trip.first_name || 'Unknown';
			const startDate = new Date(trip.created_at as string).toLocaleDateString();
			const endDate = trip.ended_at ? new Date(trip.ended_at as string).toLocaleDateString() : null;
			const status = trip.status === 'active' ? '🟢' : '⚪';

			message += `${status} <b>${trip.name}</b>\n`;
			message += `   📅 ${startDate}${endDate ? ` - ${endDate}` : ' (ongoing)'}\n`;
			message += `   💰 ${trip.expense_count} expenses • $${(trip.total_amount as number).toFixed(2)}\n`;
			message += `   👤 @${createdBy}\n\n`;
		}

		// Add active trip indicator
		const activeTrip = trips.results.find(t => t.status === 'active');
		if (activeTrip) {
			message += `\n<i>🟢 Active trip: ${activeTrip.name}</i>`;
		}

		const keyboard = [];
		
		// Add buttons for active trip
		if (activeTrip) {
			keyboard.push([{ text: '📊 Current Trip Balance', callback_data: `trip_balance_${activeTrip.id}` }]);
		}
		
		keyboard.push([{ text: '➕ Start New Trip', callback_data: 'start_trip_help' }]);

		await ctx.reply(
			message,
			{ 
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: keyboard
				}
			}
		);
	} catch (error) {
		console.error('Error listing trips:', error);
		await ctx.reply(ERROR_MESSAGES.DATABASE_ERROR);
	}
}