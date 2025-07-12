import { CommandContext, Context } from 'grammy';
import { getGroupEnrollmentStatus, enrollAllGroupMembers } from '../utils/group-enrollment';
import type { D1Database } from '@cloudflare/workers-types';

type MyContext = Context & { env?: any };
type MyCommandContext = CommandContext<MyContext>;

export async function handleStatus(ctx: MyCommandContext, db: D1Database): Promise<void> {
	try {
		// Only work in groups
		if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
			await ctx.reply('⚠️ This command only works in group chats!');
			return;
		}

		const groupId = ctx.chat.id.toString();
		
		// Get enrollment status
		const status = await getGroupEnrollmentStatus(ctx, db, groupId);
		
		// Build status message
		let message = '📊 <b>FinPals Group Status</b>\n\n';
		
		if (status.totalMembers > 0) {
			message += `👥 Total group members: ${status.totalMembers}\n`;
		}
		
		message += `✅ Enrolled in FinPals: ${status.enrolledUsers.length}\n\n`;
		
		if (status.enrolledUsers.length > 0) {
			message += '<b>Enrolled Users:</b>\n';
			status.enrolledUsers.forEach((user, index) => {
				const displayName = user.first_name || user.username || 'Unknown';
				const username = user.username ? ` (@${user.username})` : '';
				message += `${index + 1}. ${displayName}${username}\n`;
			});
		} else {
			message += '❌ No users enrolled yet!\n';
		}
		
		// Add instructions for non-enrolled users
		if (status.totalMembers > status.enrolledUsers.length || status.enrolledUsers.length === 0) {
			message += '\n<b>📝 How to enroll:</b>\n';
			message += '• Send any message in this group\n';
			message += '• Use any FinPals command (like /add)\n';
			message += '• Wait for someone to mention you in an expense\n';
			
			// Add admin option to enroll all
			const member = await ctx.getChatMember(ctx.from!.id);
			if (member.status === 'administrator' || member.status === 'creator') {
				message += '\n<b>👮 Admin Option:</b>\n';
				message += '• Use /enroll_all to automatically enroll all admins';
			}
		}
		
		await ctx.reply(message, { parse_mode: 'HTML' });
		
	} catch (error: any) {
		console.error('[Error] Status command failed:', error);
		await ctx.reply('❌ Failed to get group status. Please try again later.');
	}
}

export async function handleEnrollAll(ctx: MyCommandContext, db: D1Database): Promise<void> {
	try {
		// Only work in groups
		if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
			await ctx.reply('⚠️ This command only works in group chats!');
			return;
		}

		// Check if user is admin
		const member = await ctx.getChatMember(ctx.from!.id);
		if (member.status !== 'administrator' && member.status !== 'creator') {
			await ctx.reply('⚠️ Only group admins can use this command!');
			return;
		}

		const groupId = ctx.chat.id.toString();
		
		await ctx.reply('🔄 Enrolling all group admins...');
		
		// Enroll all admins
		const result = await enrollAllGroupMembers(ctx, db, groupId);
		
		let message = '✅ <b>Enrollment Complete!</b>\n\n';
		message += `• Successfully enrolled: ${result.enrolled} admins\n`;
		if (result.failed > 0) {
			message += `• Failed to enroll: ${result.failed} admins\n`;
		}
		message += '\n💡 <i>Note: Regular members will be enrolled when they send their first message.</i>';
		
		await ctx.reply(message, { parse_mode: 'HTML' });
		
	} catch (error: any) {
		console.error('[Error] Enroll all command failed:', error);
		await ctx.reply('❌ Failed to enroll members. Please try again later.');
	}
}