import { Context, Api } from 'grammy';
import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { users, groups, groupMembers } from '../db/schema';

export async function enrollAllGroupMembers(ctx: Context, db: Database, groupId: string): Promise<{ enrolled: number; failed: number }> {
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

export async function enrollUser(ctx: Context, db: Database, groupId: string, user: any): Promise<void> {
	const userId = user.id.toString();
	const username = user.username || null;
	const firstName = user.first_name || null;

	// Upsert user - insert if not exists, update if exists
	await db.insert(users)
		.values({
			telegramId: userId,
			username: username,
			firstName: firstName
		})
		.onConflictDoUpdate({
			target: users.telegramId,
			set: {
				username: username,
				firstName: firstName
			}
		});

	// Upsert group member - insert if not exists, update if exists
	await db.insert(groupMembers)
		.values({
			groupId: groupId,
			userId: userId,
			active: true
		})
		.onConflictDoUpdate({
			target: [groupMembers.groupId, groupMembers.userId],
			set: {
				active: true
			}
		});
}

export async function getGroupEnrollmentStatus(ctx: Context, db: Database, groupId: string): Promise<{
	enrolledUsers: Array<{ telegram_id: string; username: string | null; first_name: string | null }>;
	totalMembers: number;
}> {
	// Get all enrolled users in the group
	const enrolledUsersResult = await db
		.select({
			telegram_id: users.telegramId,
			username: users.username,
			first_name: users.firstName
		})
		.from(users)
		.innerJoin(groupMembers, eq(users.telegramId, groupMembers.userId))
		.where(and(
			eq(groupMembers.groupId, groupId),
			eq(groupMembers.active, true)
		))
		.orderBy(users.firstName, users.username);

	// Try to get the member count from Telegram
	let totalMembers = 0;
	try {
		const chat = await ctx.api.getChat(groupId);
		if ('member_count' in chat && typeof chat.member_count === 'number') {
			totalMembers = chat.member_count;
		}
	} catch (error) {
		console.error('Failed to get member count:', error);
		totalMembers = enrolledUsersResult.length || 0;
	}

	return {
		enrolledUsers: enrolledUsersResult,
		totalMembers
	};
}