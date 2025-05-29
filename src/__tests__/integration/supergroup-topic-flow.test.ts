import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../../commands/add';
import { handleBalance } from '../../commands/balance';
import { handleSettle } from '../../commands/settle';
import { createForumSupergroupContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';
import * as replyModule from '../../utils/reply';

// Mock the reply module to track topic handling
vi.mock('../../utils/reply', () => ({
    reply: vi.fn(async (ctx, text, options = {}) => {
        // Simulate the reply module's behavior
        const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
        const isForumSupergroup = ctx.chat?.type === 'supergroup' && 
                                 'is_forum' in ctx.chat && 
                                 ctx.chat.is_forum === true;
        
        const replyOptions = {
            ...options,
            ...(isForumSupergroup && threadId ? { message_thread_id: threadId } : {})
        };
        
        return ctx.reply(text, replyOptions);
    })
}));

describe('Supergroup topic flow integration', () => {
    let db: D1Database;
    let mockPreparedStatement: any;
    const TOPIC_ID = 42;
    const FINANCE_TOPIC_ID = 99;

    beforeEach(() => {
        db = createMockDB();
        mockPreparedStatement = (db as any)._getMockStatement();
        vi.clearAllMocks();
    });

    describe('Complete expense flow in forum topics', () => {
        it('should handle expense addition in specific topic', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/add 50 Team lunch',
                    message_thread_id: TOPIC_ID
                }
            });

            // Mock database responses
            mockPreparedStatement.first.mockResolvedValueOnce(null); // No active trip
            mockPreparedStatement.all.mockResolvedValueOnce({ // Group members
                results: [
                    { user_id: '123456789' },
                    { user_id: '987654321' }
                ]
            });
            mockPreparedStatement.run.mockResolvedValue({ meta: { changes: 1 } });

            await handleAdd(ctx, db);

            // Verify reply was sent to the correct topic
            expect(replyModule.reply).toHaveBeenCalled();
            const replyCall = vi.mocked(replyModule.reply).mock.calls[0];
            expect(replyCall[0].message?.message_thread_id).toBe(TOPIC_ID);
            
            // Verify the actual reply includes thread_id
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('💸 Expense Added'),
                expect.objectContaining({
                    message_thread_id: TOPIC_ID,
                    parse_mode: 'HTML'
                })
            );
        });

        it('should handle balance check in finance topic', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/balance',
                    message_thread_id: FINANCE_TOPIC_ID
                }
            });

            // Mock balance data
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        user1: '123456789',
                        user2: '987654321',
                        net_amount: 25.50,
                        user1_username: 'alice',
                        user2_username: 'bob'
                    }
                ]
            });

            await handleBalance(ctx, db);

            // Verify reply to correct topic
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Current Balances'),
                expect.objectContaining({
                    message_thread_id: FINANCE_TOPIC_ID
                })
            );
        });

        it('should handle settlement in specific topic', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/settle @bob 25.50',
                    message_thread_id: TOPIC_ID
                }
            });

            // Mock user lookup
            mockPreparedStatement.first.mockResolvedValueOnce({
                telegram_id: '987654321',
                username: 'bob'
            });

            // Mock balance calculation
            mockPreparedStatement.first.mockResolvedValueOnce({
                balance: -25.50
            });

            // Mock settlement creation
            mockPreparedStatement.run.mockResolvedValue({ meta: { changes: 1 } });

            await handleSettle(ctx, db);

            // Verify settlement confirmation in correct topic
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Settlement Recorded'),
                expect.objectContaining({
                    message_thread_id: TOPIC_ID,
                    parse_mode: 'HTML'
                })
            );
        });
    });

    describe('Topic switching', () => {
        it('should reply to different topics independently', async () => {
            // First command in topic 1
            const ctx1 = createForumSupergroupContext({
                message: {
                    text: '/balance',
                    message_thread_id: 10
                }
            });

            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });
            await handleBalance(ctx1, db);

            // Second command in topic 2
            const ctx2 = createForumSupergroupContext({
                message: {
                    text: '/balance',
                    message_thread_id: 20
                }
            });

            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });
            await handleBalance(ctx2, db);

            // Verify each reply went to correct topic
            const replyCalls = ctx1.reply.mock.calls.concat(ctx2.reply.mock.calls);
            expect(replyCalls[0][1].message_thread_id).toBe(10);
            expect(replyCalls[1][1].message_thread_id).toBe(20);
        });
    });

    describe('Callback queries in topics', () => {
        it('should handle inline keyboard callbacks in correct topic', async () => {
            const ctx = createForumSupergroupContext({
                callbackQuery: {
                    data: 'view_balance',
                    message: {
                        message_thread_id: TOPIC_ID,
                        chat: { 
                            id: -1001234567890, 
                            type: 'supergroup', 
                            is_forum: true 
                        }
                    }
                },
                message: null
            });

            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handleBalance(ctx, db);

            // Verify callback response goes to correct topic
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    message_thread_id: TOPIC_ID
                })
            );
        });
    });

    describe('Error handling in topics', () => {
        it('should send error messages to correct topic', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/add invalid',
                    message_thread_id: TOPIC_ID
                }
            });

            await handleAdd(ctx, db);

            // Error message should go to same topic
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Invalid format'),
                expect.objectContaining({
                    message_thread_id: TOPIC_ID
                })
            );
        });
    });
});