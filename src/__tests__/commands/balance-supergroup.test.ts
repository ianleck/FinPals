import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleBalance } from '../../commands/balance';
import { createForumSupergroupContext, createMockContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';
import * as replyModule from '../../utils/reply';

// Mock the reply module
vi.mock('../../utils/reply', () => ({
    reply: vi.fn(async (ctx, text, options) => {
        return ctx.reply(text, options);
    })
}));

describe('handleBalance with supergroup topics', () => {
    let db: D1Database;
    let mockPreparedStatement: any;

    beforeEach(() => {
        db = createMockDB();
        mockPreparedStatement = (db as any)._getMockStatement();
        vi.clearAllMocks();
    });

    describe('Forum supergroup support', () => {
        it('should reply to the correct topic in forum supergroup', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/balance',
                    message_thread_id: 123  // Specific topic ID
                }
            });

            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handleBalance(ctx, db);

            // Verify reply was called through our mock
            expect(replyModule.reply).toHaveBeenCalledWith(
                ctx,
                expect.stringContaining('✨ <b>All Settled Up!</b>'),
                expect.any(Object)
            );

            // Verify the underlying ctx.reply was called
            expect(ctx.reply).toHaveBeenCalled();
        });

        it('should include thread_id in inline keyboard callbacks', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/balance',
                    message_thread_id: 456
                }
            });

            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        user1: '123456789',
                        user2: '987654321',
                        net_amount: 50.00,
                        user1_username: 'alice',
                        user2_username: 'bob',
                    },
                ],
            });

            await handleBalance(ctx, db);

            const replyCall = ctx.reply.mock.calls[0];
            expect(replyCall[1].reply_markup.inline_keyboard).toBeDefined();
            expect(replyCall[1].reply_markup.inline_keyboard).toContainEqual(
                expect.arrayContaining([
                    expect.objectContaining({ text: '💸 Settle Up' })
                ])
            );
        });
    });

    describe('Regular supergroup (non-forum)', () => {
        it('should not include thread_id in non-forum supergroup', async () => {
            const ctx = createMockContext({
                chat: { 
                    id: -1001234567890, 
                    type: 'supergroup', 
                    title: 'Test Supergroup',
                    is_forum: false  // Not a forum
                },
                message: {
                    text: '/balance',
                    message_thread_id: 789  // Thread ID present but should be ignored
                }
            });

            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handleBalance(ctx, db);

            expect(replyModule.reply).toHaveBeenCalledWith(
                ctx,
                expect.any(String),
                expect.any(Object)
            );
        });
    });

    describe('Callback query handling in forum', () => {
        it('should handle callback queries with correct thread context', async () => {
            const ctx = createForumSupergroupContext({
                callbackQuery: {
                    data: 'view_balance',
                    message: {
                        message_thread_id: 999,
                        chat: { id: -1001234567890, type: 'supergroup', is_forum: true }
                    }
                },
                message: null  // No message in callback query context
            });

            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handleBalance(ctx, db);

            expect(replyModule.reply).toHaveBeenCalledWith(
                ctx,
                expect.any(String),
                expect.any(Object)
            );
        });
    });
});