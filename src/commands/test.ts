import { Context } from 'grammy';

export async function handleTest(ctx: Context): Promise<void> {
	if (!ctx.from || !ctx.chat || ctx.chat.type === 'private') {
		await ctx.reply('❌ This command only works in group chats.');
		return;
	}

	try {
		// Get bot's permissions in the chat
		const botMember = await ctx.api.getChatMember(ctx.chat.id, ctx.me.id);
		
		let permissionInfo = '🤖 <b>Bot Permissions:</b>\n\n';
		permissionInfo += `Status: ${botMember.status}\n`;
		
		if (botMember.status === 'administrator') {
			permissionInfo += '\n✅ Bot is an admin\n';
			permissionInfo += `Can delete messages: ${botMember.can_delete_messages ? '✅' : '❌'}\n`;
			permissionInfo += `Can restrict members: ${botMember.can_restrict_members ? '✅' : '❌'}\n`;
			permissionInfo += `Can pin messages: ${botMember.can_pin_messages ? '✅' : '❌'}\n`;
		} else {
			permissionInfo += '\n❌ Bot is NOT an admin\n';
			permissionInfo += 'Need admin rights to delete messages!\n';
		}
		
		// Try to delete the test command message
		if (ctx.message) {
			try {
				await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
				permissionInfo += '\n✅ Successfully deleted your message!';
			} catch (error: any) {
				permissionInfo += `\n❌ Could not delete message: ${error.message}`;
			}
		}
		
		await ctx.reply(permissionInfo, { parse_mode: 'HTML' });
	} catch (error) {
		console.error('Error in test command:', error);
		await ctx.reply('❌ Error checking permissions');
	}
}