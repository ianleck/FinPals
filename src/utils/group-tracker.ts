import { Context } from 'grammy';
import { Env } from '../index';

type MyContext = Context & { env: Env };

export async function trackGroupMetadata(ctx: MyContext): Promise<void> {
	try {
		// Skip if no chat context or no DB
		if (!ctx.chat || !ctx.env.DB) {
			return;
		}

		// Only process group-related events and messages in groups
		if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
			return;
		}

		const groupId = ctx.chat.id.toString();
		const groupTitle = ctx.chat.title || 'Unknown Group';

		// Check if group exists in our database
		const existingGroup = await ctx.env.DB.prepare(
			'SELECT telegram_id FROM groups WHERE telegram_id = ?'
		).bind(groupId).first();

		if (!existingGroup) {
			// Create group entry
			await ctx.env.DB.prepare(
				'INSERT INTO groups (telegram_id, title) VALUES (?, ?)'
			).bind(groupId, groupTitle).run();
		} else {
			// Update group title if changed
			await ctx.env.DB.prepare(
				'UPDATE groups SET title = ? WHERE telegram_id = ?'
			).bind(groupTitle, groupId).run();
		}

		// Track user if they sent a message
		if (ctx.from && !ctx.from.is_bot) {
			const userId = ctx.from.id.toString();
			const username = ctx.from.username || null;
			const firstName = ctx.from.first_name || null;

			// Ensure user exists
			await ctx.env.DB.prepare(
				'INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)'
			).bind(userId, username, firstName).run();

			// Update user info if changed
			await ctx.env.DB.prepare(
				'UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?'
			).bind(username, firstName, userId).run();

			// Ensure user is member of group
			await ctx.env.DB.prepare(
				'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)'
			).bind(groupId, userId).run();

			// Reactivate if was inactive
			await ctx.env.DB.prepare(
				'UPDATE group_members SET active = TRUE WHERE group_id = ? AND user_id = ?'
			).bind(groupId, userId).run();
		}

		// Handle when users leave
		if (ctx.message?.left_chat_member) {
			const leftUserId = ctx.message.left_chat_member.id.toString();
			await ctx.env.DB.prepare(
				'UPDATE group_members SET active = FALSE WHERE group_id = ? AND user_id = ?'
			).bind(groupId, leftUserId).run();
		}

		// Handle new members
		if (ctx.message?.new_chat_members) {
			for (const newMember of ctx.message.new_chat_members) {
				if (!newMember.is_bot) {
					const newUserId = newMember.id.toString();
					const newUsername = newMember.username || null;
					const newFirstName = newMember.first_name || null;

					// Ensure user exists
					await ctx.env.DB.prepare(
						'INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)'
					).bind(newUserId, newUsername, newFirstName).run();

					// Add to group
					await ctx.env.DB.prepare(
						'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)'
					).bind(groupId, newUserId).run();
				}
			}
		}
	} catch (error: any) {
		console.error('[Error] Failed to track group metadata:', error?.message || 'Unknown error');
	}
}