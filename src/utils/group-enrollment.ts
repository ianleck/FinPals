import { Context, Api } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';

export async function enrollAllGroupMembers(ctx: Context, db: D1Database, groupId: string): Promise<{ enrolled: number; failed: number }> {
	const api = ctx.api;
	let enrolled = 0;
	let failed = 0;

	try {
		// Get all administrators first (they have detailed info)
		const admins = await api.getChatAdministrators(groupId);
		
		for (const admin of admins) {
			if (!admin.user.is_bot) {
				try {
					await enrollUser(ctx, db, groupId, admin.user);
					enrolled++;
				} catch (error) {
					console.error(`Failed to enroll admin ${admin.user.id}:`, error);
					failed++;
				}
			}
		}

		// For regular members, we need to use different approach
		// Telegram doesn't provide a direct API to get all members
		// We'll rely on the existing tracking + provide a manual enrollment option
		
		return { enrolled, failed };
	} catch (error) {
		console.error('[Error] Failed to enroll group members:', error);
		throw error;
	}
}

export async function enrollUser(ctx: Context, db: D1Database, groupId: string, user: any): Promise<void> {
	const userId = user.id.toString();
	const username = user.username || null;
	const firstName = user.first_name || null;

	// Ensure user exists
	await db.prepare(
		'INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)'
	).bind(userId, username, firstName).run();

	// Update user info if changed
	await db.prepare(
		'UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?'
	).bind(username, firstName, userId).run();

	// Ensure user is member of group
	await db.prepare(
		'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)'
	).bind(groupId, userId).run();

	// Ensure they're active
	await db.prepare(
		'UPDATE group_members SET active = TRUE WHERE group_id = ? AND user_id = ?'
	).bind(groupId, userId).run();
}

export async function getGroupEnrollmentStatus(ctx: Context, db: D1Database, groupId: string): Promise<{
	enrolledUsers: Array<{ telegram_id: string; username: string | null; first_name: string | null }>;
	totalMembers: number;
}> {
	// Get all enrolled users in the group
	const enrolledUsers = await db.prepare(`
		SELECT u.telegram_id, u.username, u.first_name
		FROM users u
		JOIN group_members gm ON u.telegram_id = gm.user_id
		WHERE gm.group_id = ? AND gm.active = TRUE
		ORDER BY u.first_name, u.username
	`).bind(groupId).all<{ telegram_id: string; username: string | null; first_name: string | null }>();

	// Try to get the member count from Telegram
	let totalMembers = 0;
	try {
		const chat = await ctx.api.getChat(groupId);
		if ('member_count' in chat) {
			totalMembers = chat.member_count || 0;
		}
	} catch (error) {
		console.error('Failed to get member count:', error);
		totalMembers = enrolledUsers.results?.length || 0;
	}

	return {
		enrolledUsers: enrolledUsers.results as Array<{ telegram_id: string; username: string | null; first_name: string | null }>,
		totalMembers
	};
}