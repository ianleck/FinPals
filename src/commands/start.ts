import { Context } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { type Database, withRetry } from '../db';
import { users, groups, groupMembers } from '../db/schema';
import { WelcomeMessage } from '../utils/constants';

export async function handleStart(ctx: Context, db: Database) {
	const chatType = ctx.chat?.type;
	const username = ctx.from?.username || ctx.from?.first_name || 'there';
	const userId = ctx.from?.id.toString();
	const chatId = ctx.chat?.id.toString();

	if (chatType === 'private') {
		// Initialize user in database if not exists
		if (userId) {
			await withRetry(async () => {
				// Check if user exists
				const existingUser = await db
					.select()
					.from(users)
					.where(eq(users.telegramId, userId))
					.limit(1);

				if (existingUser.length === 0) {
					// Insert new user
					await db.insert(users).values({
						telegramId: userId,
						username: ctx.from?.username || null,
						firstName: ctx.from?.first_name || null,
						lastName: ctx.from?.last_name || null,
					});
				}
			});
		}

		// Private chat welcome
		await ctx.reply(
			`👋 Welcome ${username}!\n\n` +
				`I'm FinPals - your personal finance companion!\n\n` +
				`<b>🏠 In Private Chat:</b>\n` +
				`• Track personal expenses\n` +
				`• Set budgets by category\n` +
				`• View spending analytics\n` +
				`• See summaries across all groups\n\n` +
				`<b>👥 In Group Chat:</b>\n` +
				`• Split expenses with friends\n` +
				`• Track who owes whom\n` +
				`• Manage trips and events\n` +
				`• Export group reports\n\n` +
				`Start with /add to track a personal expense!`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{ text: '💵 Add Personal Expense', callback_data: 'add_expense_help' }],
						[{ text: '💰 Set Budget', callback_data: 'budget_help' }],
						[{ text: '➕ Add to Group', url: 'https://t.me/FinPalsBot?startgroup=true' }],
						[{ text: '❓ Help', callback_data: 'help' }],
					],
				},
			}
		);
	} else if (chatId && (chatType === 'group' || chatType === 'supergroup')) {
		// Initialize group in database if not exists
		await withRetry(async () => {
			// Check if group exists
			const existingGroup = await db
				.select()
				.from(groups)
				.where(eq(groups.telegramId, chatId))
				.limit(1);

			if (existingGroup.length === 0) {
				// Insert new group
				await db.insert(groups).values({
					telegramId: chatId,
					title: ctx.chat?.title || 'Unnamed Group',
				});
			}

			// Add bot creator/admin as member if they exist
			if (userId) {
				// Ensure user exists
				const existingUser = await db
					.select()
					.from(users)
					.where(eq(users.telegramId, userId))
					.limit(1);

				if (existingUser.length === 0) {
					await db.insert(users).values({
						telegramId: userId,
						username: ctx.from?.username || null,
						firstName: ctx.from?.first_name || null,
						lastName: ctx.from?.last_name || null,
					});
				}

				// Check if user is already a member
				const existingMembership = await db
					.select()
					.from(groupMembers)
					.where(
						and(
							eq(groupMembers.groupId, chatId),
							eq(groupMembers.userId, userId)
						)
					)
					.limit(1);

				if (existingMembership.length === 0) {
					// Add user as group member
					await db.insert(groupMembers).values({
						groupId: chatId,
						userId: userId,
					});
				}
			}
		});

		// Group chat welcome
		await ctx.reply(WelcomeMessage, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '💵 Add First Expense', callback_data: 'add_expense_help' }],
					[{ text: '❓ View Commands', callback_data: 'help' }],
				],
			},
		});
	}
}