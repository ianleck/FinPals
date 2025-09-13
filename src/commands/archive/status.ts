import { CommandContext, Context } from 'grammy';
import { getGroupEnrollmentStatus, enrollAllGroupMembers } from '../utils/group-enrollment';
import type { Database } from '../db';

type MyContext = Context & { env?: any };
type MyCommandContext = CommandContext<MyContext>;

export async function handleStatus(ctx: MyCommandContext, db: Database): Promise<void> {
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
		
		// Add warning if not everyone is enrolled
		if (status.totalMembers > 0 && status.enrolledUsers.length < status.totalMembers) {
			message += '\n⚠️ <b>Important:</b>\n';
			message += 'Not all group members are enrolled!\n';
			message += 'They need to send any message in the group first.\n\n';
			
			// Add button to attempt enrollment
			message += 'Admin can try: /enroll_all\n';
		}
		
		message += '\n💡 <i>New members are automatically enrolled when they send their first message.</i>';
		
		await ctx.reply(message, { parse_mode: 'HTML' });
		
		console.log(`Status check for group ${groupId}: ${status.enrolledUsers.length}/${status.totalMembers} enrolled`);
		
	} catch (error) {
		console.error('Error in handleStatus:', error);
		await ctx.reply('❌ Error checking group status. Please try again.');
	}
}

export async function handleEnrollAll(ctx: MyCommandContext, db: Database): Promise<void> {
	try {
		// Only work in groups
		if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
			await ctx.reply('⚠️ This command only works in group chats!');
			return;
		}

		// Check if user is admin
		const member = await ctx.getChatMember(ctx.from!.id);
		const isAdmin = member.status === 'administrator' || member.status === 'creator';
		
		if (!isAdmin) {
			await ctx.reply('⚠️ Only group admins can use this command!');
			return;
		}

		const groupId = ctx.chat.id.toString();
		const statusMsg = await ctx.reply('🔄 Attempting to enroll all visible members...');
		
		const result = await enrollAllGroupMembers(ctx, db, groupId);
		
		let message = '✅ <b>Enrollment Complete!</b>\n\n';
		message += `📊 Results:\n`;
		message += `• Users enrolled: ${result.enrolled}\n`;
		message += `• Failed enrollments: ${result.failed}\n`;
		
		if (result.failed > 0) {
			message += `\n⚠️ Could not enroll ${result.failed} users.\n`;
			message += 'They need to send a message in the group first.';
		}
		
		// Delete the processing message
		try {
			await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
		} catch {
			// Ignore if deletion fails
		}
		
		await ctx.reply(message, { parse_mode: 'HTML' });
		
	} catch (error) {
		console.error('Error in handleEnrollAll:', error);
		await ctx.reply('❌ Error enrolling members. Please try again.');
	}
}