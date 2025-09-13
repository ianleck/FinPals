import { Context } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { createDb, type Database, withRetry } from '../db';
import { users, groups, groupMembers } from '../db/schema';
import { checkAndReconcileUser } from './reconcile-pending-users';
import type { Env } from '../index';

type MyContext = Context & { env: Env };

export async function trackGroupMetadata(ctx: MyContext): Promise<void> {
	try {
		// Skip if no chat context or no HYPERDRIVE config
		if (!ctx.chat || !ctx.env.HYPERDRIVE) {
			return;
		}

		// Only process group-related events and messages in groups
		if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
			return;
		}

		const db = createDb(ctx.env);
		const groupId = ctx.chat.id.toString();
		const groupTitle = ctx.chat.title || 'Unknown Group';

		await withRetry(async () => {
			// Check if group exists in our database
			const existingGroup = await db
				.select()
				.from(groups)
				.where(eq(groups.telegramId, groupId))
				.limit(1);

			if (existingGroup.length === 0) {
				// Create group entry
				await db.insert(groups).values({
					telegramId: groupId,
					title: groupTitle,
				});
			} else {
				// Update group title if changed
				await db
					.update(groups)
					.set({ title: groupTitle })
					.where(eq(groups.telegramId, groupId));
			}

			// Track user if they sent a message
			if (ctx.from && !ctx.from.is_bot) {
				const userId = ctx.from.id.toString();
				const username = ctx.from.username || null;
				const firstName = ctx.from.first_name || null;
				const lastName = ctx.from.last_name || null;

				// IMPORTANT: Reconcile pending user BEFORE creating/updating the real user
				// This prevents duplicate entries when a pending user becomes active
				await checkAndReconcileUser(db, userId, username);

				// Ensure user exists - upsert pattern
				const existingUser = await db
					.select()
					.from(users)
					.where(eq(users.telegramId, userId))
					.limit(1);

				if (existingUser.length === 0) {
					await db.insert(users).values({
						telegramId: userId,
						username,
						firstName,
						lastName,
					});
				} else {
					// Update user info if changed
					await db
						.update(users)
						.set({ username, firstName, lastName })
						.where(eq(users.telegramId, userId));
				}

				// Ensure user is member of group
				const existingMembership = await db
					.select()
					.from(groupMembers)
					.where(
						and(
							eq(groupMembers.groupId, groupId),
							eq(groupMembers.userId, userId)
						)
					)
					.limit(1);

				if (existingMembership.length === 0) {
					await db.insert(groupMembers).values({
						groupId,
						userId,
						active: true,
					});
				} else if (!existingMembership[0].active) {
					// Reactivate if was inactive
					await db
						.update(groupMembers)
						.set({ active: true })
						.where(
							and(
								eq(groupMembers.groupId, groupId),
								eq(groupMembers.userId, userId)
							)
						);
				}
			}

			// Handle when users leave
			if (ctx.message?.left_chat_member) {
				const leftUserId = ctx.message.left_chat_member.id.toString();
				await db
					.update(groupMembers)
					.set({ active: false })
					.where(
						and(
							eq(groupMembers.groupId, groupId),
							eq(groupMembers.userId, leftUserId)
						)
					);
			}

			// Handle new members
			if (ctx.message?.new_chat_members) {
				for (const newMember of ctx.message.new_chat_members) {
					if (!newMember.is_bot) {
						const newUserId = newMember.id.toString();
						const newUsername = newMember.username || null;
						const newFirstName = newMember.first_name || null;
						const newLastName = newMember.last_name || null;

						// Reconcile if they were previously added as pending
						await checkAndReconcileUser(db, newUserId, newUsername);

						// Ensure user exists - upsert pattern
						const existingUser = await db
							.select()
							.from(users)
							.where(eq(users.telegramId, newUserId))
							.limit(1);

						if (existingUser.length === 0) {
							await db.insert(users).values({
								telegramId: newUserId,
								username: newUsername,
								firstName: newFirstName,
								lastName: newLastName,
							});
						}

						// Add to group
						const existingMembership = await db
							.select()
							.from(groupMembers)
							.where(
								and(
									eq(groupMembers.groupId, groupId),
									eq(groupMembers.userId, newUserId)
								)
							)
							.limit(1);

						if (existingMembership.length === 0) {
							await db.insert(groupMembers).values({
								groupId,
								userId: newUserId,
								active: true,
							});
						}
					}
				}
			}
		});
	} catch (error: any) {
		console.error('[Error] Failed to track group metadata:', error?.message || 'Unknown error');
	}
}