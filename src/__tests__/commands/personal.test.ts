import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handlePersonal } from '../../commands/personal';
import { createPrivateContext, createMockContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('handlePersonal command', () => {
    let db: D1Database;
    let mockPreparedStatement: any;

    beforeEach(() => {
        db = createMockDB();
        mockPreparedStatement = (db as any)._getMockStatement();
        vi.clearAllMocks();
    });

    describe('Command validation', () => {
        it('should show error in group chat', async () => {
            const ctx = createMockContext();
            
            await handlePersonal(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                '💬 This command only works in private chat. DM me directly!'
            );
        });

        it('should work in private chat', async () => {
            const ctx = createPrivateContext();
            
            // Mock the count query
            mockPreparedStatement.first.mockResolvedValueOnce({ count: 0 });

            await handlePersonal(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('📊 Personal Expense Tracker'),
                expect.any(Object)
            );
        });
    });

    describe('Show personal expenses', () => {
        it('should show empty state when no expenses', async () => {
            const ctx = createPrivateContext();
            
            // Mock the count query
            mockPreparedStatement.first.mockResolvedValueOnce({ count: 0 });

            await handlePersonal(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('No personal expenses recorded yet'),
                expect.objectContaining({
                    parse_mode: 'HTML',
                    reply_markup: expect.objectContaining({
                        inline_keyboard: expect.arrayContaining([
                            expect.arrayContaining([
                                expect.objectContaining({ text: '➕ Add Personal Expense' })
                            ])
                        ])
                    })
                })
            );
        });

        it('should show expense summary with categories', async () => {
            const ctx = createPrivateContext();
            
            // Mock expense count
            mockPreparedStatement.first.mockResolvedValueOnce({ count: 5 });
            
            // Mock total amount
            mockPreparedStatement.first.mockResolvedValueOnce({ total: 150.50 });
            
            // Mock category breakdown
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    { category: 'Food & Dining', total: 80.00 },
                    { category: 'Transportation', total: 50.50 },
                    { category: 'Entertainment', total: 20.00 }
                ]
            });

            await handlePersonal(ctx, db);

            const replyCall = ctx.reply.mock.calls[0];
            expect(replyCall[0]).toContain('Total Expenses: 5');
            expect(replyCall[0]).toContain('Total Spent: $150.50');
            expect(replyCall[0]).toContain('Food & Dining: $80.00');
            expect(replyCall[0]).toContain('Transportation: $50.50');
            expect(replyCall[0]).toContain('Entertainment: $20.00');
        });
    });

    describe('Date filters', () => {
        it('should handle today filter', async () => {
            const ctx = createPrivateContext({
                message: { text: '/personal today' }
            });
            
            mockPreparedStatement.first.mockResolvedValueOnce({ count: 2 });
            mockPreparedStatement.first.mockResolvedValueOnce({ total: 25.00 });
            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handlePersonal(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining("Today's Expenses"),
                expect.any(Object)
            );
        });

        it('should handle week filter', async () => {
            const ctx = createPrivateContext({
                message: { text: '/personal week' }
            });
            
            mockPreparedStatement.first.mockResolvedValueOnce({ count: 10 });
            mockPreparedStatement.first.mockResolvedValueOnce({ total: 200.00 });
            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handlePersonal(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('This Week'),
                expect.any(Object)
            );
        });

        it('should handle month filter', async () => {
            const ctx = createPrivateContext({
                message: { text: '/personal month' }
            });
            
            mockPreparedStatement.first.mockResolvedValueOnce({ count: 30 });
            mockPreparedStatement.first.mockResolvedValueOnce({ total: 1500.00 });
            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handlePersonal(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('This Month'),
                expect.any(Object)
            );
        });
    });

    describe('Error handling', () => {
        it('should handle database errors gracefully', async () => {
            const ctx = createPrivateContext();
            
            mockPreparedStatement.first.mockRejectedValueOnce(new Error('DB Error'));

            await handlePersonal(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                '❌ Error retrieving personal expenses. Please try again.'
            );
        });
    });
});