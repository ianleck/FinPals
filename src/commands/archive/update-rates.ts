import { Context } from 'grammy';
import { updateExchangeRatesInDB } from '../utils/currency';

export async function handleUpdateRates(ctx: Context, db: D1Database) {
	// Only allow in private chats with admins
	if (ctx.chat?.type !== 'private') {
		await ctx.reply('⚠️ This command only works in private chats.');
		return;
	}

	// Optional: Add admin check here
	// const adminIds = ['YOUR_ADMIN_ID'];
	// if (!adminIds.includes(ctx.from!.id.toString())) {
	//     await ctx.reply('❌ You are not authorized to use this command.');
	//     return;
	// }

	await ctx.reply('🔄 Updating exchange rates from Frankfurter API...');

	try {
		const success = await updateExchangeRatesInDB(db);
		
		if (success) {
			// Get the updated rates count
			const result = await db.prepare(
				'SELECT COUNT(*) as count FROM exchange_rates WHERE last_updated > datetime("now", "-1 minute")'
			).first();
			
			await ctx.reply(
				`✅ <b>Exchange rates updated successfully!</b>\n\n` +
				`📊 Updated ${result?.count || 0} currencies\n` +
				`🌐 Source: Frankfurter API (ECB data)\n` +
				`⏱️ Next auto-update: in ~12 hours`,
				{ parse_mode: 'HTML' }
			);
		} else {
			await ctx.reply(
				'❌ Failed to update exchange rates. Please try again later.\n\n' +
				'The bot will continue using cached rates.'
			);
		}
	} catch (error) {
		console.error('Error in update rates command:', error);
		await ctx.reply('❌ An error occurred while updating rates.');
	}
}