import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reply, editMessageText } from '../../utils/reply';
import { Context } from 'grammy';

describe('reply utility', () => {
    let mockCtx: any;

    beforeEach(() => {
        mockCtx = {
            reply: vi.fn().mockResolvedValue({ message_id: 1 }),
            editMessageText: vi.fn().mockResolvedValue(true),
            chat: null,
            message: null,
            callbackQuery: null,
        };
    });

    describe('reply function', () => {
        it('should reply without thread_id in regular group', async () => {
            mockCtx.chat = { type: 'group' };
            mockCtx.message = { message_thread_id: 123 };

            await reply(mockCtx as Context, 'Test message', { parse_mode: 'HTML' });

            expect(mockCtx.reply).toHaveBeenCalledWith('Test message', {
                parse_mode: 'HTML',
            });
            expect(mockCtx.reply).not.toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ message_thread_id: expect.any(Number) })
            );
        });

        it('should reply without thread_id in private chat', async () => {
            mockCtx.chat = { type: 'private' };
            mockCtx.message = { message_thread_id: 123 };

            await reply(mockCtx as Context, 'Test message');

            expect(mockCtx.reply).toHaveBeenCalledWith('Test message', {});
        });

        it('should include thread_id in forum-enabled supergroup', async () => {
            mockCtx.chat = { type: 'supergroup', is_forum: true };
            mockCtx.message = { message_thread_id: 456 };

            await reply(mockCtx as Context, 'Test message', { parse_mode: 'HTML' });

            expect(mockCtx.reply).toHaveBeenCalledWith('Test message', {
                parse_mode: 'HTML',
                message_thread_id: 456,
            });
        });

        it('should not include thread_id in non-forum supergroup', async () => {
            mockCtx.chat = { type: 'supergroup', is_forum: false };
            mockCtx.message = { message_thread_id: 789 };

            await reply(mockCtx as Context, 'Test message');

            expect(mockCtx.reply).toHaveBeenCalledWith('Test message', {});
        });

        it('should handle callback queries in forum supergroup', async () => {
            mockCtx.chat = { type: 'supergroup', is_forum: true };
            mockCtx.callbackQuery = { message: { message_thread_id: 999 } };

            await reply(mockCtx as Context, 'Callback response');

            expect(mockCtx.reply).toHaveBeenCalledWith('Callback response', {
                message_thread_id: 999,
            });
        });

        it('should preserve existing options when adding thread_id', async () => {
            mockCtx.chat = { type: 'supergroup', is_forum: true };
            mockCtx.message = { message_thread_id: 111 };

            await reply(mockCtx as Context, 'Test', {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] },
            });

            expect(mockCtx.reply).toHaveBeenCalledWith('Test', {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] },
                message_thread_id: 111,
            });
        });
    });

    describe('editMessageText function', () => {
        it('should edit without thread_id in regular group', async () => {
            mockCtx.chat = { type: 'group' };
            mockCtx.message = { message_thread_id: 123 };

            await editMessageText(mockCtx as Context, 'Edited message');

            expect(mockCtx.editMessageText).toHaveBeenCalledWith('Edited message', {});
        });

        it('should include thread_id when editing in forum supergroup', async () => {
            mockCtx.chat = { type: 'supergroup', is_forum: true };
            mockCtx.callbackQuery = { message: { message_thread_id: 222 } };

            await editMessageText(mockCtx as Context, 'Edited message', {
                parse_mode: 'HTML',
            });

            expect(mockCtx.editMessageText).toHaveBeenCalledWith('Edited message', {
                parse_mode: 'HTML',
                message_thread_id: 222,
            });
        });
    });
});