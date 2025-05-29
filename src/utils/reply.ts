import { Context } from 'grammy';

/**
 * Reply to a message with proper thread/topic support for supergroups
 * This ensures messages are sent to the correct topic in forum-enabled supergroups
 */
export async function reply(ctx: Context, text: string, options: any = {}) {
    // Get the message thread ID if in a forum-enabled supergroup
    const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
    
    // Check if this is a forum-enabled supergroup
    const isForumSupergroup = ctx.chat?.type === 'supergroup' && 
                             'is_forum' in ctx.chat && 
                             ctx.chat.is_forum === true;
    
    // Create reply options with thread ID if needed
    const replyOptions = {
        ...options,
        ...(isForumSupergroup && threadId ? { message_thread_id: threadId } : {})
    };
    
    return ctx.reply(text, replyOptions);
}

/**
 * Edit a message with proper thread/topic support for supergroups
 */
export async function editMessageText(ctx: Context, text: string, options: any = {}) {
    // Get the message thread ID if in a forum-enabled supergroup
    const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
    
    // Check if this is a forum-enabled supergroup
    const isForumSupergroup = ctx.chat?.type === 'supergroup' && 
                             'is_forum' in ctx.chat && 
                             ctx.chat.is_forum === true;
    
    // Create edit options with thread ID if needed
    const editOptions = {
        ...options,
        ...(isForumSupergroup && threadId ? { message_thread_id: threadId } : {})
    };
    
    return ctx.editMessageText(text, editOptions);
}