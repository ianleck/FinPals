import { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { reply } from '../utils/reply';

export async function handleFixDuplicates(ctx: Context, db: D1Database) {
	// Admin only command
	const userId = ctx.from?.id.toString();
	const member = await ctx.getChatMember(ctx.from!.id);
	if (member.status !== 'administrator' && member.status !== 'creator') {
		await reply(ctx, '❌ This command is for administrators only.');
		return;
	}

	await reply(ctx, '🔧 Scanning for duplicate participants...');

	try {
		// Find all pending users that have real user counterparts
		const duplicates = await db.prepare(`
			SELECT 
				p.telegram_id as pending_id,
				p.username as username,
				r.telegram_id as real_id
			FROM users p
			JOIN users r ON r.username = p.username
			WHERE p.telegram_id LIKE 'pending_%'
			AND r.telegram_id NOT LIKE 'pending_%'
		`).all();

		if (!duplicates.results || duplicates.results.length === 0) {
			await reply(ctx, '✅ No duplicate participants found!');
			return;
		}

		let fixedCount = 0;
		let errors = 0;

		for (const dup of duplicates.results) {
			try {
				const pendingId = dup.pending_id as string;
				const realId = dup.real_id as string;
				const username = dup.username as string;

				// Merge expense_splits - avoid constraint violations
				await db.prepare(`
					UPDATE expense_splits 
					SET user_id = ? 
					WHERE user_id = ? 
					AND expense_id NOT IN (
						SELECT expense_id FROM expense_splits WHERE user_id = ?
					)
				`).bind(realId, pendingId, realId).run();

				// For splits that would cause duplicates, sum them up
				const conflictingSplits = await db.prepare(`
					SELECT es1.expense_id, es1.amount + es2.amount as total_amount
					FROM expense_splits es1
					JOIN expense_splits es2 ON es1.expense_id = es2.expense_id
					WHERE es1.user_id = ? AND es2.user_id = ?
				`).bind(pendingId, realId).all();

				if (conflictingSplits.results && conflictingSplits.results.length > 0) {
					for (const split of conflictingSplits.results) {
						// Update the real user's split with combined amount
						await db.prepare(`
							UPDATE expense_splits 
							SET amount = ? 
							WHERE expense_id = ? AND user_id = ?
						`).bind(split.total_amount, split.expense_id, realId).run();

						// Delete the pending user's split
						await db.prepare(`
							DELETE FROM expense_splits 
							WHERE expense_id = ? AND user_id = ?
						`).bind(split.expense_id, pendingId).run();
					}
				}

				// Update expenses where pending user was payer
				await db.prepare(`
					UPDATE expenses SET paid_by = ? WHERE paid_by = ?
				`).bind(realId, pendingId).run();

				// Update settlements
				await db.prepare(`
					UPDATE settlements SET from_user = ? WHERE from_user = ?
				`).bind(realId, pendingId).run();

				await db.prepare(`
					UPDATE settlements SET to_user = ? WHERE to_user = ?
				`).bind(realId, pendingId).run();

				// Update group memberships
				await db.prepare(`
					DELETE FROM group_members 
					WHERE user_id = ? 
					AND group_id IN (
						SELECT group_id FROM group_members WHERE user_id = ?
					)
				`).bind(pendingId, realId).run();

				// Delete pending user
				await db.prepare(`
					DELETE FROM users WHERE telegram_id = ?
				`).bind(pendingId).run();

				fixedCount++;
				console.log(`Fixed duplicate for @${username}: ${pendingId} -> ${realId}`);
			} catch (error) {
				console.error(`Error fixing duplicate ${dup.pending_id}:`, error);
				errors++;
			}
		}

		let message = `🔧 <b>Duplicate Fix Complete</b>\n\n`;
		message += `• Found ${duplicates.results.length} duplicate users\n`;
		message += `• Successfully fixed: ${fixedCount}\n`;
		if (errors > 0) {
			message += `• Errors: ${errors}\n`;
		}
		message += `\n✅ Your expense splits have been consolidated!`;

		await reply(ctx, message, { parse_mode: 'HTML' });

	} catch (error) {
		console.error('Error in fix duplicates:', error);
		await reply(ctx, '❌ Error fixing duplicates. Please try again.');
	}
}