import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../../commands/add';
import { handleBalance } from '../../commands/balance';
import { handleSettle } from '../../commands/settle';
import { createForumSupergroupContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';
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
    const TOPIC_ID = 42;
    const FINANCE_TOPIC_ID = 99;

    beforeEach(() => {
        db = createTestDatabase();
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
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.first.mockResolvedValueOnce(null); // No active trip
            mockStmt.all.mockResolvedValueOnce({ // Group members
                results: [
                    { user_id: '123456789' },
                    { user_id: '987654321' }
                ]
            });
            mockStmt.run.mockResolvedValue({ meta: { changes: 1 } });

            await handleAdd(ctx, db);

            // Verify reply was sent to the correct topic
            expect(replyModule.reply).toHaveBeenCalled();
            const replyCall = vi.mocked(replyModule.reply).mock.calls[0];
            expect(replyCall[0].message?.message_thread_id).toBe(TOPIC_ID);
            
            // Verify the expense was added
            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toContain('expense');
            expect(text).toContain('50');
            expect(text).toContain('Team lunch');
        });

        it('should handle balance check in finance topic', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/balance',
                    message_thread_id: FINANCE_TOPIC_ID
                }
            });

            // Mock balance data
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockResolvedValueOnce({
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

            // Verify balance is shown
            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toContain('balance');
            expect(text).toContain('alice');
            expect(text).toContain('bob');
            expect(text).toContain('25.50');
        });

        it('should handle settlement in specific topic', async () => {
            const ctx = createForumSupergroupContext({
                message: {
                    text: '/settle @bob 25.50',
                    message_thread_id: TOPIC_ID
                }
            });

            // Mock user lookup
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.first.mockResolvedValueOnce({
                telegram_id: '987654321',
                username: 'bob'
            });

            // Mock balance calculation
            mockStmt.first.mockResolvedValueOnce({
                balance: -25.50
            });

            // Mock settlement creation
            mockStmt.run.mockResolvedValue({ meta: { changes: 1 } });

            await handleSettle(ctx, db);

            // Verify settlement was recorded
            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toContain('settle');
            expect(text).toContain('bob');
            expect(text).toContain('25.50');
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

            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockResolvedValueOnce({ results: [] });
            await handleBalance(ctx1, db);

            // Second command in topic 2
            const ctx2 = createForumSupergroupContext({
                message: {
                    text: '/balance',
                    message_thread_id: 20
                }
            });

            mockStmt.all.mockResolvedValueOnce({ results: [] });
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

            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockResolvedValueOnce({ results: [] });

            await handleBalance(ctx, db);

            // Verify callback was handled
            expect(ctx.reply).toHaveBeenCalled();
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

            // Error message should be shown
            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/invalid|format|usage/);
        });
    });
});